import { useTranslation } from "react-i18next";
import ReactCrop from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { sheetButtonClass } from "../../../components/ui/bottom-sheet";
import { BottomDrawer } from "../../../components/ui/bottom-drawer";
import { NATIVE_SHEET_BG } from "../../../components/ui/action-sheet";
import { useDesktopBreakpoint } from "../../../hooks/useDesktopBreakpoint";
import freegrindLogo from "../../../images/freegrind-logo.webp";
import { MediaToolButton, TakenOnGrindrToolIcon } from "../chat/drawerUi";
import { ProfilePictureDrawer } from "./ProfilePictureDrawer";
import { MAX_PROFILE_PHOTOS } from "./profileEditorUtils";
import type { ProfileEditorState } from "./useProfileEditor";

/** The sheets behind the photo slots: the picture pool drawer and, once a
 * file is picked there, the two-step crop/thumbnail upload drawer. */
export function ProfilePhotoFlows({ photos }: { photos: ProfileEditorState["photos"] }) {
	const { t } = useTranslation();
	const isDesktop = useDesktopBreakpoint();

	return (
		<>
			{photos.pendingFile ? (
				<BottomDrawer
					title={t("profile_editor.photo_upload.title")}
					onClose={photos.cancelPendingUpload}
					onConfirm={() => void photos.confirmPendingUpload()}
					confirmLabel={photos.uploadStep === "crop"
						? t("profile_editor.photo_upload.next", { defaultValue: "Next" })
						: t("profile_editor.photo_upload.confirm")}
					isProcessing={photos.isUploading || photos.isCropping}
					isDesktop={isDesktop}
					bg={NATIVE_SHEET_BG}
					footerLeft={photos.uploadStep === "thumbnail" ? (
						<button
							type="button"
							onClick={() => photos.setUploadStep("crop")}
							disabled={photos.isUploading}
							className={sheetButtonClass("secondary")}
						>
							{t("profile_editor.photo_upload.back", { defaultValue: "Back" })}
						</button>
					) : undefined}
				>
					<p className="px-4 pb-2 text-xs text-[var(--text-muted)]">
						{photos.uploadStep === "crop"
							? t("profile_editor.photo_upload.crop_hint", { defaultValue: "Crop your photo" })
							: t("profile_editor.photo_upload.thumbnail_hint", { defaultValue: "Choose the thumbnail shown in the grid" })}
					</p>
					<div className="flex min-h-0 flex-1 flex-col">
						<div className="min-h-0 flex-1 overflow-y-auto">
							{photos.previewUrl && (
								<div className="px-4 pb-3">
									<div className="flex justify-center">
										<style>{`
											@keyframes photo-logo-shine { 0%, 100% { filter: drop-shadow(0 0 2px rgba(255,140,0,0.3)) brightness(1); } 50% { filter: drop-shadow(0 0 7px rgba(255,140,0,0.95)) brightness(1.25); } }
											.photo-logo-shine { animation: photo-logo-shine 2.8s ease-in-out infinite; }
											.photo-crop .ReactCrop__crop-mask { display: none !important; } .photo-crop .ReactCrop__crop-selection { background-image: none !important; animation: none !important; outline: none !important; border: 3px solid rgba(255,255,255,0.6) !important; border-radius: 20px !important; box-shadow: 0 0 0 9999px rgba(0,0,0,0.5) !important; }
											.photo-crop .ReactCrop__drag-handle.ord-n, .photo-crop .ReactCrop__drag-handle.ord-s, .photo-crop .ReactCrop__drag-handle.ord-e, .photo-crop .ReactCrop__drag-handle.ord-w { display: none !important; }
											.photo-crop .ReactCrop__drag-handle { background: transparent !important; border: none !important; width: 18px !important; height: 18px !important; }
											.photo-crop .ord-nw { transform: none !important; top: 6px !important; left: 6px !important; border-top: 2px solid white !important; border-left: 2px solid white !important; border-top-left-radius: 11px !important; }
											.photo-crop .ord-ne { transform: none !important; top: 6px !important; right: 6px !important; border-top: 2px solid white !important; border-right: 2px solid white !important; border-top-right-radius: 11px !important; }
											.photo-crop .ord-sw { transform: none !important; bottom: 6px !important; left: 6px !important; border-bottom: 2px solid white !important; border-left: 2px solid white !important; border-bottom-left-radius: 11px !important; }
											.photo-crop .ord-se { transform: none !important; bottom: 6px !important; right: 6px !important; border-bottom: 2px solid white !important; border-right: 2px solid white !important; border-bottom-right-radius: 11px !important; }
											.photo-crop .ReactCrop__drag-handle::after { content: ""; position: absolute; inset: -16px; } /* grabbable well beyond the drawn corner */
											/* The straight edges resize too, through invisible bars (none for a fixed aspect, where only corners can). */
											.photo-crop { --rc-drag-bar-size: 24px; }
											.photo-crop:not(.ReactCrop--fixed-aspect) .ReactCrop__drag-bar { display: block !important; }
											.photo-crop .ord-nw, .photo-crop .ord-se { cursor: nwse-resize !important; }
											.photo-crop .ord-ne, .photo-crop .ord-sw { cursor: nesw-resize !important; }
											.photo-crop .ReactCrop__drag-bar.ord-n, .photo-crop .ReactCrop__drag-bar.ord-s { cursor: ns-resize !important; }
											.photo-crop .ReactCrop__drag-bar.ord-e, .photo-crop .ReactCrop__drag-bar.ord-w { cursor: ew-resize !important; }
										`}</style>
										<div data-sheet-no-drag className="relative overflow-hidden rounded-[20px]">
											<ReactCrop
												key={photos.uploadStep}
												crop={photos.crop}
												aspect={photos.uploadStep === "thumbnail" ? 1 : undefined}
												onChange={(c) => { photos.setIsDraggingCrop(true); photos.setCrop(c); }}
												onComplete={(c) => { photos.setIsDraggingCrop(false); photos.setCompletedCrop(c); }}
												ruleOfThirds={photos.isDraggingCrop}
												minWidth={150}
												minHeight={150}
												className="photo-crop ReactCrop--no-animate"
												style={{ maxHeight: "45dvh", display: "block" }}
											>
												<img
													ref={photos.imgRef}
													src={photos.previewUrl}
													alt="Preview"
													className="block"
													style={{ maxHeight: "45dvh" }}
													onLoad={photos.handleImageLoad}
												/>
											</ReactCrop>
											{photos.uploadStep === "thumbnail" && photos.takenOnGrindr && photos.crop && (
												<div
													className="absolute inline-flex items-center gap-1.5 pointer-events-none"
													style={{
														left: `calc(${photos.crop.unit === "%" ? photos.crop.x + "%" : photos.crop.x + "px"} + 10px)`,
														top: `calc(${photos.crop.unit === "%" ? (photos.crop.y + photos.crop.height) + "%" : (photos.crop.y + photos.crop.height) + "px"} - 10px)`,
														transform: "translateY(-100%)",
													}}
												>
													<img src={freegrindLogo} alt="" className="h-5 w-5 rounded-full photo-logo-shine" />
													<span className="inline-flex items-center gap-1 rounded-full bg-black/65 px-2 py-1 text-[10px] font-semibold text-white">
														<span>{t("chat.time.just_now", { defaultValue: "just now" })}</span>
													</span>
												</div>
											)}
										</div>
									</div>
								</div>
							)}
						</div>
						{/* Below the preview, like the chat upload's tool buttons. */}
						<div className="flex shrink-0 items-center justify-center gap-3 px-4 pb-3 pt-1">
							<MediaToolButton
								icon={<TakenOnGrindrToolIcon active={photos.takenOnGrindr} />}
								label={t("profile_editor.photo_upload.taken_on_grindr")}
								active={photos.takenOnGrindr}
								onClick={() => photos.setTakenOnGrindr(!photos.takenOnGrindr)}
							/>
						</div>
					</div>
				</BottomDrawer>
			) : null}
			{photos.isDrawerOpen && !photos.pendingFile ? (
				<ProfilePictureDrawer
					images={photos.poolImages}
					isLoading={photos.isPoolLoading}
					error={photos.poolError}
					onRetry={() => void photos.loadPoolImages()}
					usedHashes={photos.hashes}
					remainingSlots={Math.max(0, MAX_PROFILE_PHOTOS - photos.hashes.length)}
					isSelecting={photos.isSaving}
					onAddSelectedImages={photos.handleAddSelectedImages}
					deletingHash={photos.deletingPoolHash}
					onDeleteImage={photos.handleDeletePoolImage}
					onUploadFile={photos.handleDrawerUploadFile}
					onClose={() => photos.setIsDrawerOpen(false)}
					closeRef={photos.drawerCloseRef}
					isDesktop={isDesktop}
				/>
			) : null}
		</>
	);
}
