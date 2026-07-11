import { plural } from '@lingui/core/macro';

function FilePickerInput({
  hidden,
  supportedMimeTypes,
  maxMediaAttachments,
  mediaAttachments,
  disabled = false,
  setMediaAttachments,
  // Optional. If given, any picked file whose real `file.type` is a
  // video gets routed to this callback instead of the normal
  // setMediaAttachments flow -- one call per video file, synchronously.
  // This is the freelimbo fork's YouTube-upload routing: rather than a
  // separate "add video" button/input (which was easy to bypass by
  // accident -- e.g. Android's file picker lets you switch to "Google
  // Photos" and pick a video even when `accept` says images-only, since
  // `accept` is only a hint some picker UIs don't respect), the SAME
  // "attach media" input accepts everything, and this checks the actual
  // selected file's type in JS afterwards, which can't be bypassed by
  // however the OS/browser happened to present the picker. When
  // omitted, behavior is unchanged from upstream.
  onVideoPick,
}) {
  return (
    <input
      type="file"
      hidden={hidden}
      accept={supportedMimeTypes?.join(',')}
      multiple={
        maxMediaAttachments === undefined ||
        maxMediaAttachments - mediaAttachments >= 2
      }
      disabled={disabled}
      onChange={async (e) => {
        const files = e.target.files;
        if (!files) return;

        let pickedFiles = Array.from(files);
        if (onVideoPick) {
          const videoFiles = pickedFiles.filter((file) =>
            file.type?.startsWith('video/'),
          );
          pickedFiles = pickedFiles.filter(
            (file) => !file.type?.startsWith('video/'),
          );
          videoFiles.forEach(onVideoPick);
        }
        if (pickedFiles.length === 0) {
          e.target.value = '';
          return;
        }

        let mediaFiles;
        try {
          mediaFiles = pickedFiles.map((file) => ({
            file, // keep the File object; avoids eager full read from slow storage (e.g. microSD)
            fileName: file.name,
            type: file.type,
            size: file.size,
            url: URL.createObjectURL(file),
            id: null, // indicate uploaded state
            description: null,
          }));
        } catch (err) {
          console.error('Failed to read file(s):', err);
          return;
        }
        console.log('MEDIA ATTACHMENTS', files, mediaFiles);

        // Validate max media attachments
        if (mediaAttachments.length + mediaFiles.length > maxMediaAttachments) {
          alert(
            plural(maxMediaAttachments, {
              one: 'You can only attach up to 1 file.',
              other: 'You can only attach up to # files.',
            }),
          );
        } else {
          setMediaAttachments((attachments) => {
            return attachments.concat(mediaFiles);
          });
        }
        // Reset
        e.target.value = '';
      }}
    />
  );
}

export default FilePickerInput;
