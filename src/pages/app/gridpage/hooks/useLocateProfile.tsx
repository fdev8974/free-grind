import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { useApiFunctions } from "../../../../hooks/useApiFunctions";
import { usePreferences } from "../../../../contexts/PreferencesContext";
import { decodeGeohash, encodeGeohash } from "../../../../utils/geohash";
import { appLog } from "../../../../utils/logger";
import { ConfirmDialog } from "../../../../components/ui/confirm-dialog";
import { LocateResultSheet, type LocateProgress, type LocateRoundResult } from "../components/LocateResultSheet";

/**
 * Shared "Locate" (trilateration) flow for ProfileDetailsModal hosts —
 * GridPage and GridProfilePage both render `locateSheet` next to the modal.
 */
export function useLocateProfile({ isDesktop }: { isDesktop: boolean }) {
	const { t } = useTranslation();
	const apiFunctions = useApiFunctions();
	const { geohash } = usePreferences();

	const [isLocatingProfile, setIsLocatingProfile] = useState(false);
	const [locateProgress, setLocateProgress] = useState<LocateProgress | null>(null);
	const [isLocateSheetOpen, setIsLocateSheetOpen] = useState(false);
	const locateCancelledRef = useRef(false);
	const [pendingLocateProfileId, setPendingLocateProfileId] = useState<string | null>(null);

    const solveTrilateration = (points: { lat: number, lon: number, dist: number }[]) => {
        // 1. Convert Lat/Lon to a simple XY grid (meters) relative to the first point
        // This avoids floating point errors with large coordinate numbers
        const p1 = points[0];
        const p2 = points[1];
        const p3 = points[2];

        // Rough conversion: 1 degree lat = 111320m
        const latToM = 111320;
        const lonToM = 111320 * Math.cos(p1.lat * (Math.PI / 180));

        const x2 = (p2.lon - p1.lon) * lonToM;
        const y2 = (p2.lat - p1.lat) * latToM;
        const x3 = (p3.lon - p1.lon) * lonToM;
        const y3 = (p3.lat - p1.lat) * latToM;

        const r1 = p1.dist;
        const r2 = p2.dist;
        const r3 = p3.dist;

        // 2. Standard Trilateration Formula for 2D intersection
        // Derived from (x-x1)^2 + (y-y1)^2 = r1^2 ... etc
        const A = 2 * x2;
        const B = 2 * y2;
        const C = Math.pow(r1, 2) - Math.pow(r2, 2) + Math.pow(x2, 2) + Math.pow(y2, 2);
        const D = 2 * x3;
        const E = 2 * y3;
        const F = Math.pow(r1, 2) - Math.pow(r3, 2) + Math.pow(x3, 2) + Math.pow(y3, 2);

        const denom = A * E - D * B;
        if (Math.abs(denom) < 1e-10) {
            throw new Error("Trilateration failed: measurement points are collinear or too close together. Try again with a larger initial offset.");
        }
        const x = (C * E - F * B) / denom;
        const y = (A * F - D * C) / denom;

        // 3. Convert XY back to Lat/Lon
        return {
            lat: p1.lat + (y / latToM),
            lon: p1.lon + (x / lonToM)
        };
    };

    const handleTriangleProfile = (targetProfileId: string) => {
        if (isLocatingProfile) {
            // A run is already in progress — just bring its sheet back.
            setIsLocateSheetOpen(true);
            return;
        }

        if (!geohash) {
            toast.error(t("browse_page.errors.location_required"));
            return;
        }

        setPendingLocateProfileId(targetProfileId);
    };

    const runLocate = async (targetProfileId: string) => {
        if (!geohash) {
            toast.error(t("browse_page.errors.location_required"));
            return;
        }

        let originalLat: number;
        let originalLon: number;

        try {
            // Decode starting position
            const decoded = decodeGeohash(geohash);
            originalLat = (decoded.lat[0] + decoded.lat[1]) / 2;
            originalLon = (decoded.lon[0] + decoded.lon[1]) / 2;
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t("browse_page.errors.location_read_failed"),
            );
            return;
        }

        setIsLocatingProfile(true);
        locateCancelledRef.current = false;
        setLocateProgress({
            status: "measuring",
            isRestoring: false,
            initialDistance: null,
            totalRounds: 0,
            round: 0,
            step: 0,
            lat: originalLat,
            lon: originalLon,
            errorMeters: null,
            rounds: [],
            errorMessage: null,
        });
        setIsLocateSheetOpen(true);

        const updateProgress = (patch: Partial<LocateProgress>) => {
            setLocateProgress((prev) => (prev ? { ...prev, ...patch } : prev));
        };

        const waitMs = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

        class LocateCancelledError extends Error {}
        const throwIfCancelled = () => {
            if (locateCancelledRef.current) throw new LocateCancelledError();
        };

        const putServerLocation = async (lat: number, lon: number, targetGeohash: string) => {
            const payloads = [
                { lat, lon },
                { latitude: lat, longitude: lon },
                { geohash: targetGeohash },
                { nearbyGeoHash: targetGeohash },
            ];

            for (const payload of payloads) {
                try {
                    const response = await apiFunctions.request("/v4/location", {
                        method: "PUT",
                        body: payload,
                    });
                    if (response.status >= 200 && response.status < 300) return;
                } catch (e) {
                    continue;
                }
            }
            throw new Error("Failed to update server location across all payload types.");
        };

        const getDistanceFromProfile = async (): Promise<number | null> => {
            try {
                const profile = await apiFunctions.getProfileDetail(targetProfileId);
                return typeof profile.distance === "number" && Number.isFinite(profile.distance)
                    ? profile.distance
                    : null;
            } catch {
                return null;
            }
        };

        try {
            const initialDist = await getDistanceFromProfile();
            throwIfCancelled();
            if (initialDist === null) {
                throw new Error(t("profile_details.location_finder_error_distance"));
            }

            let currentLat = originalLat;
            let currentLon = originalLon;
            const targetPrecision = 15;
            let rounds = Math.ceil(Math.log(initialDist / targetPrecision) / Math.log(3));
            rounds = Math.max(2, Math.min(rounds, 6));

            // Degrees per meter (approximate)
            let offset = (initialDist*1.5) / 111320;

            const roundResults: LocateRoundResult[] = [];
            updateProgress({ status: "running", initialDistance: initialDist, totalRounds: rounds });

            for (let i = 0; i < rounds; i++) {
                updateProgress({ round: i, step: 0 });
                const points = [
                    { lat: currentLat + offset, lon: currentLon }, // Top
                    { lat: currentLat - (offset / 2), lon: currentLon + (offset * 0.866) }, // Bottom Right
                    { lat: currentLat - (offset / 2), lon: currentLon - (offset * 0.866) }, // Bottom Left
                ];

                const results: { lat: number, lon: number, dist: number }[] = [];

                for (const [pointIndex, p] of points.entries()) {
                    await putServerLocation(p.lat, p.lon, encodeGeohash(p.lat, p.lon));
                    throwIfCancelled();
                    await waitMs(5000); // Wait for distance calculation to propagate on server
                    throwIfCancelled();
                    const d = await getDistanceFromProfile();
                    throwIfCancelled();
                    if (d !== null) results.push({ lat: p.lat, lon: p.lon, dist: d });
                    updateProgress({ step: pointIndex + 1 });
                }

                if (results.length === 3) {
                    const estimate = solveTrilateration(results);
                    currentLat = estimate.lat;
                    currentLon = estimate.lon;
                    offset /= 3; // Zoom in for the next round

                    const errorMeters = Math.round(offset * 111320);
                    roundResults.push({ round: i + 1, lat: currentLat, lon: currentLon, errorMeters, failed: false });
                    updateProgress({
                        lat: currentLat,
                        lon: currentLon,
                        errorMeters,
                        rounds: [...roundResults],
                    });
                } else {
                    roundResults.push({ round: i + 1, lat: currentLat, lon: currentLon, errorMeters: Math.round(offset * 111320), failed: true });
                    updateProgress({ rounds: [...roundResults] });
                }
            }

            updateProgress({ status: "done", isRestoring: true });
            // Pop the sheet back up if the user dismissed it mid-run.
            setIsLocateSheetOpen(true);
        } catch (error) {
            if (error instanceof LocateCancelledError) {
                updateProgress({ status: "cancelled", isRestoring: true });
            } else {
                updateProgress({
                    status: "error",
                    isRestoring: true,
                    errorMessage: error instanceof Error ? error.message : t("profile_details.location_finder_error_general"),
                });
            }
        } finally {
            if (!locateCancelledRef.current) {
                await waitMs(10000);
            }
            try {
                await putServerLocation(originalLat, originalLon, geohash);
            } catch (error) {
                appLog.error("Failed to restore server location after locate", error);
                toast.error(t("browse_page.errors.location_read_failed"));
            }
            updateProgress({ isRestoring: false });
            setIsLocatingProfile(false);
        }
    };

	const locateSheet = (
		<>
			<ConfirmDialog
				isOpen={pendingLocateProfileId !== null}
				title={t("profile_details.location_finder_confirm_title", { defaultValue: "Location finder" })}
				message={t("profile_details.location_finder_confirm_message", {
					defaultValue:
						"Free Grind can triangulate this profile's position by repeatedly changing your location on the server. This takes a few minutes; your location is restored afterwards.",
				})}
				warning={t("profile_details.location_finder_confirm_warning", {
					defaultValue:
						"This violates Grindr's terms of service and can get your account banned. Use at your own risk.",
				})}
				confirmLabel={t("profile_details.location_finder_confirm_start", { defaultValue: "Locate anyway" })}
				confirmTone="danger"
				cancelLabel={t("entitlement_bypass.prompt_cancel", { defaultValue: "Cancel" })}
				onConfirm={() => {
					const targetProfileId = pendingLocateProfileId;
					setPendingLocateProfileId(null);
					if (targetProfileId) void runLocate(targetProfileId);
				}}
				onCancel={() => setPendingLocateProfileId(null)}
			/>
			{locateProgress && isLocateSheetOpen ? (
				<LocateResultSheet
					progress={locateProgress}
					onClose={() => setIsLocateSheetOpen(false)}
					onCancel={() => {
						locateCancelledRef.current = true;
						setLocateProgress((prev) => (prev ? { ...prev, status: "cancelled", isRestoring: true } : prev));
					}}
					isDesktop={isDesktop}
				/>
			) : null}
		</>
	);

	return { isLocatingProfile, handleTriangleProfile, locateSheet };
}
