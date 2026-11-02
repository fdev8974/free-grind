import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { proxyMediaUrl } from "../utils/mediaProxy";
import {
	captureVideoPoster,
	getVideoPoster,
	isVideoPosterUncapturable,
	requestVideoPoster,
	subscribeVideoPosters,
} from "../services/videoPosterStore";

const CAPTURE_WAIT_MS = 3000;

/**
 * A video's first frame as a still preview. With a `posterKey`, the frame is
 * captured once and stored (see videoPosterStore), and later renders show
 * that small image instead of loading and decoding the video again. Renders
 * nothing while the stored still is being looked up.
 *
 * `className` goes on whichever element is shown (<img> or <video>);
 * `onReady` gets it once a picture is there.
 */
export function VideoFirstFrame({
	src,
	posterKey,
	conversationId = null,
	capture = true,
	waitForCapture = false,
	className,
	onReady,
	onFail,
}: {
	src: string;
	/** Stable key of this video (msg:<messageId>, drawer:<mediaId>, ...); none means no caching. */
	posterKey?: string | null;
	/** Set for chat media, so the still goes with its conversation. */
	conversationId?: string | null;
	/** False while the key doesn't belong to this video for good yet (e.g. a message still sending). */
	capture?: boolean;
	/**
	 * Another preview of the same key is about to capture the still (e.g. a
	 * reply quote, whose quoted bubble is in the same thread): wait for it
	 * rather than loading the video a second time — up to CAPTURE_WAIT_MS.
	 */
	waitForCapture?: boolean;
	className?: string;
	onReady?: (element: HTMLImageElement | HTMLVideoElement) => void;
	/** The video can't be shown on this device (no picture, or it errors). */
	onFail?: () => void;
}) {
	const poster = useSyncExternalStore(subscribeVideoPosters, () =>
		posterKey ? getVideoPoster(posterKey) : null,
	);
	const [failedPoster, setFailedPoster] = useState<string | null>(null);
	// Once this mount shows the video, it keeps doing so — swapping it for the
	// still it just captured would only flash.
	const showsVideoRef = useRef(false);
	useEffect(() => {
		if (posterKey) requestVideoPoster(posterKey);
	}, [posterKey]);
	const uncapturable = useSyncExternalStore(subscribeVideoPosters, () =>
		posterKey ? isVideoPosterUncapturable(posterKey) : true,
	);
	const isWaiting = waitForCapture && poster === null && !uncapturable && !showsVideoRef.current;
	const [waitExpired, setWaitExpired] = useState(false);
	useEffect(() => {
		if (!isWaiting) return;
		const timer = window.setTimeout(() => setWaitExpired(true), CAPTURE_WAIT_MS);
		return () => window.clearTimeout(timer);
	}, [isWaiting]);

	if (poster === undefined || (isWaiting && !waitExpired)) return null;
	if (poster && poster !== failedPoster && !showsVideoRef.current) {
		return (
			<img
				src={poster}
				alt=""
				draggable={false}
				onLoad={(e) => onReady?.(e.currentTarget)}
				// A broken stored still: show the video itself instead.
				onError={() => setFailedPoster(poster)}
				className={className}
			/>
		);
	}
	showsVideoRef.current = true;
	return (
		<video
			src={proxyMediaUrl(src, { as: "video" })}
			preload="metadata"
			muted
			playsInline
			onLoadedMetadata={(e) => {
				const video = e.currentTarget;
				if (!video.videoWidth || !video.videoHeight) {
					onFail?.();
					return;
				}
				// Seeking a hair past 0 makes the browser decode and show a real frame.
				video.currentTime = 0.001;
			}}
			onSeeked={(e) => {
				const video = e.currentTarget;
				if (posterKey && capture) captureVideoPoster(posterKey, conversationId, video);
				onReady?.(video);
			}}
			onError={onFail}
			className={className}
		/>
	);
}
