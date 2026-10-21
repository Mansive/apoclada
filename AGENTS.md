# Apoclada

Follow ComfyUI's `AGENTS.md` (two folders up) for code style.

## Testing the gallery

ComfyUI's output folder holds the user's own images, so tests never show it. Put test files in
`ComfyUI/output/claudetest` and open `/studio?folder=claudetest`: the gallery, the gallery picker
and the viewer then see only that folder, and the page gets no other pages' jobs, so nothing else
from the output folder appears on it. Don't open the Gallery tab or the picker on plain `/studio`.
Delete the test folder afterwards.
