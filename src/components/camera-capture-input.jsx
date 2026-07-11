const isMobileSafari =
  /iPad|iPhone|iPod/.test(navigator.userAgent) &&
  /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

function CameraCaptureInput({
  hidden,
  disabled = false,
  supportedMimeTypes,
  setMediaAttachments,
  // Optional. Same contract as FilePickerInput's onVideoPick: if given,
  // a captured/picked file whose real `file.type` is a video gets routed
  // here instead of the normal setMediaAttachments flow, so it can go to
  // the freelimbo fork's YouTube-upload path instead of local storage.
  // `capture="environment"` below usually forces an actual camera app on
  // mobile (where this bypass risk doesn't really apply), but desktop
  // browsers that report `'capture' in input` as true (enough for
  // supportsCameraCapture to show this button at all) often fall back to
  // a normal file picker that doesn't honor `capture`, which reopens the
  // same accept-attribute-is-only-a-hint gap FilePickerInput had.
  onVideoPick,
}) {
  // If not Mobile Safari, only apply image/*
  // Chrome Android doesn't show the camera if image and video combined
  // It also can't switch between photo and video mode like iOS/Safari
  const filteredSupportedMimeTypes = isMobileSafari
    ? supportedMimeTypes
    : supportedMimeTypes?.filter((mimeType) => !/^image\//i.test(mimeType));

  return (
    <input
      type="file"
      hidden={hidden}
      accept={filteredSupportedMimeTypes?.join(',')}
      capture="environment"
      disabled={disabled}
      onChange={async (e) => {
        const files = e.target.files;
        if (!files) return;
        const mediaFile = Array.from(files)[0];
        if (!mediaFile) return;

        if (onVideoPick && mediaFile.type?.startsWith('video/')) {
          onVideoPick(mediaFile);
          e.target.value = null;
          return;
        }

        let fileData;
        try {
          fileData = await mediaFile.arrayBuffer();
        } catch (err) {
          console.error('Failed to read file:', err);
          return;
        }
        setMediaAttachments((attachments) => [
          ...attachments,
          {
            fileData,
            fileName: mediaFile.name,
            type: mediaFile.type,
            size: mediaFile.size,
            url: URL.createObjectURL(mediaFile),
            id: null, // indicate uploaded state
            description: null,
          },
        ]);
        e.target.value = null;
      }}
    />
  );
}

export const supportsCameraCapture = (() => {
  const input = document.createElement('input');
  return 'capture' in input;
})();

export default CameraCaptureInput;
