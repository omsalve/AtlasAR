let libraryPromise: Promise<MindARImageApi> | undefined;

/** Load only our self-hosted tracking code, after a visitor chooses an AR flow. */
export function loadTrackingLibrary(): Promise<MindARImageApi> {
  if (window.MINDAR?.IMAGE) return Promise.resolve(window.MINDAR.IMAGE);
  if (!libraryPromise) libraryPromise = new Promise<MindARImageApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.type = "module";
    script.src = "/vendor/mindar/mindar-image.prod.js";
    script.onload = () => {
      if (window.MINDAR?.IMAGE) resolve(window.MINDAR.IMAGE);
      else { libraryPromise = undefined; reject(new Error("The image tracking module did not initialize.")); }
    };
    script.onerror = () => { script.remove(); libraryPromise = undefined; reject(new Error("Image tracking files could not be loaded. Reload this page and try again.")); };
    document.head.appendChild(script);
  });
  return libraryPromise;
}
