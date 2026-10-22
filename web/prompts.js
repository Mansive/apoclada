// The default prompt mixes both formats from USERGUIDE.md: a first line of tags in their recommended
// order (quality, score, meta, year, character, series, artist, general), then prose for the scene,
// framing, lighting and mood, with exact quoted text for lettering. The guide doesn't spell out score
// or year tags, so those follow Anima, whose order it matches. No artist tag: users report @artist
// tags barely work on MOSS.
export const MOSS_PROMPT = "masterpiece, best quality, score_7, highres, year 2025, hatsune miku, vocaloid, 1girl, solo, smile, cream sweater\nShe sits at a small table by the rain-streaked window of a corner café on a rainy evening, holding a steaming mug in both hands, her long twintails falling over her shoulders. Seen from the side at eye level, warm amber light from a pendant lamp falls across her face, while the street outside glows cool blue with blurred city lights. A small chalkboard on the table reads \"Open late\" in white chalk. Soft anime illustration with clean lines; the mood is calm and cozy.";
// MiniMax's H3 prompt guide (VIDEO_PROMPT_WRITING_GUIDE_base_en.md) uses three fields: shots with camera
// moves and speaker-tagged <d> dialogue, ambient sound, and background score. Filling both sound fields
// keeps the model from inventing speech. Image-to-video prompts start with START_LINE and a blank line.
// The lines are Japanese, one of the 11 languages H3's README lists as stable for dialogue.
// Later shots start with their cut time (MM:SS.mmm), which has to fall inside the video, so the
// examples cut to a second shot at 1.5 s to fit every length from 2 s up.
export const VIDEO_PROMPT = `integrated_multimodal_description: [Shot 1] 2D-animated, soft anime style, a medium close-up shot frames Hatsune Miku, the only customer in a quiet corner café on a rainy evening, sitting by the rain-streaked window in a cream knit sweater with a steaming mug in both hands. The camera pushes in with small amplitude at slow speed as she takes a slow sip from the mug and smiles. [Shot 2] At 00:01.500, the camera cuts to a close-up of Hatsune Miku's face lit by the warm café light as she lowers the mug, smiles, and with a soft, bright voice (S1) says: <d>[Japanese] 美味しい</d>

overall_soundscape: Rain patters steadily against the window glass, the ceramic mug clinks softly on the wooden table, and muffled traffic hums outside.

non_diegetic_music: A slow lo-fi piano melody with soft brushed drums.`;
// With a start image the guide describes only the motion and what <Picture 1> keeps, so this example
// swaps the scene description for that and the subject for "the main character"; the shots, timing,
// voice, line and music stay the same as VIDEO_PROMPT.
export const ANIMATE_PROMPT = `integrated_multimodal_description: [Shot 1] The scene shown in <Picture 1> comes to life, keeping its art style, characters, clothing, lighting and composition. The camera pushes in with small amplitude at slow speed as the main character breathes gently and smiles. [Shot 2] At 00:01.500, the camera cuts to a close-up of the main character's face in the same setting and lighting as they smile, and with a soft, bright voice (S1) says: <d>[Japanese] 美味しい</d>

overall_soundscape: Soft ambient sound that fits the setting, with faint fabric rustling as the character moves.

non_diegetic_music: A slow lo-fi piano melody with soft brushed drums.`;
// Reference videos follow MiniMax's full-reference guide (VIDEO_PROMPT_WRITING_GUIDE_ref_en.md): the
// references get <Subject N> labels, a summary and a retention line, and the shots move to
// detailed_description after a style sentence. The scene, shots, voice, line and music match VIDEO_PROMPT,
// with <Subject 1> from <Picture 1> in place of the described character.
export const REFERENCE_PROMPT = `subject_definitions:
<Subject 1> is the main character in <Picture 1>, with their face, hair and clothing.

summary:
[reference generation] The target video shows <Subject 1> sipping from a steaming mug by the window of a quiet café on a rainy evening, then a close-up as <Subject 1> lowers the mug and speaks.

retention_analysis:
<Subject 1> (appears in [Shot 1], [Shot 2]): fully_preserved - the character's face, hair and clothing are retained.

detailed_description:
The target video keeps the art style of <Picture 1>, with warm, soft lighting.
[Shot 1] A medium close-up shot frames <Subject 1>, the only customer in a quiet corner café on a rainy evening, sitting by the rain-streaked window with a steaming mug in both hands. The camera pushes in with small amplitude at slow speed as <Subject 1> takes a slow sip from the mug and smiles.
[Shot 2] At 00:01.500, the camera cuts to a close-up of <Subject 1>'s face lit by the warm café light as they lower the mug, smile, and with a soft, bright voice <Subject 1> (S1) says: <d>[Japanese] 美味しい</d>

overall_soundscape:
Rain patters steadily against the window glass, the ceramic mug clinks softly on the wooden table, and muffled traffic hums outside.

non_diegetic_music:
A slow lo-fi piano melody with soft brushed drums.`;
// pablodawson's 360° orbit LoRA was trained with this one caption and asks for it verbatim.
export const ORBIT_PROMPT = "One frozen instant. Only the camera moves. In a continuous 360 orbit. Preserve every person and object in exactly the same world position, orientation, shape and pose throughout the shot. Airborne objects remain suspended at the captured height and angle: no wobbling, shaking, spinning, drifting, falling or continued action. Keep faces, hands, clothing, liquids and the background motionless while retaining their natural appearance. Camera parallax is the only source of apparent movement. No cuts, zoom, morphing or added objects.";
// MiniMax's guide opens prompts with start or end images with a line saying where they fall in the video.
export const START_LINE = "For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.";
export const FRAMES_LINE = /^(For the target video|How the reference pictures align)[^\n]*\n\n/;
// Krea 2's prompting guide asks for natural-language sentences and quoted text, so Kroma gets the same
// scene in prose, ordered like the guide's examples: subject and details, then lighting, style and framing.
export const KREA2_PROMPT = "Hatsune Miku sits at a small table by the rain-streaked window of a corner café on a rainy evening, smiling softly as she holds a steaming mug in both hands. She wears a cream knit sweater, and her long teal twintails fall over her shoulders. A small chalkboard on the table reads \"Open late\" in white chalk. Warm amber light from a pendant lamp falls across her face, while the street outside glows cool blue with blurred city lights. Soft anime illustration with clean lines and a muted, warm color palette, seen from the side at eye level in a medium shot. The mood is calm and cozy.";
// "Enhance prompt" adapts the prompt rewriters in ComfyUI's MOSS and Krea 2 templates
// (comfyui-workflow-templates 0.11.89, MIT, see NOTICE): the text encoder rewrites the prompt with TextGenerate first.
// MOSS passes its instructions as the system prompt; Krea 2's template puts them in front of the prompt.
export const MOSS_ENHANCE = `You turn a user's image idea into one detailed caption for a text-to-image model. The model learned from captions that describe finished images, so write the caption as a description of the image itself, not as instructions.

Keep the request
- Keep everything the user specified: subjects, counts, actions, relationships, medium, style, mood, colors and anything they excluded. Never contradict or drop it.
- Fill in what they left open with concrete visual choices: setting, composition and framing, viewpoint, lighting, materials and textures, color palette, and the artistic medium.
- Describe only what can be seen. Leave out sounds, smells, backstory and intentions.
- Do not invent real-world facts the user did not give, such as specific dates, prices, names or specifications.

Text in the image
- Quote every piece of visible text exactly and in full, in double quotes. Keep the user's wording, language, spelling, capitalization, punctuation and line breaks; never translate, shorten or rewrite it, and never quote the same text twice.
- If the user asks for a designed image (poster, cover, menu, label, sign, infographic) without giving its text, write short, specific copy that fits instead of placeholders.
- For each block of text, say what it is printed on (sign, poster, card, packaging, screen), where it sits and in what reading order, its alignment, line breaks and size relative to the rest, its font style, color and spacing, and how legible it is (clearly readable, slightly blurred, partly hidden).
- Do not mention watermarks or artist signatures.

Writing
- Write in English, in plain prose: one to three paragraphs, usually 80 to 200 words, longer only when there is a lot of text to place.
- Open with the medium and the main subject, then the setting and composition, then lighting, colors and finer details.
- Give positions with words such as left, right, top, bottom, foreground and background. No coordinates, lists, headings, JSON or Markdown.
- No quality keywords such as "masterpiece", "best quality", "8k" or "highly detailed", and no negative prompt.

Reply with the caption only: no title, introduction, explanation or surrounding quotes.`;
export const KREA2_ENHANCE = `You are an expert prompt engineer for text-to-image models. Your task is to expand the user's prompt into a highly effective image-generation prompt.

Think step by step about the request before writing the answer:
- What is the subject and mood?
- What visual styles, mediums, and lighting options would fit? Consider two or three alternatives and pick the one that best serves the request.
- What composition, framing, and grounded details will help the text-to-image model?

Then output a single expanded prompt paragraph.

Follow these rules strictly:
1. **Faithfulness First:** Preserve all original subjects, actions, colors, and spatial relationships. Do not add new objects, props, characters, or animals unless the user clearly implies them.
2. **Practical T2I Structure:** Write a prompt that a text-to-image model can parse cleanly. Group subjects with their own attributes and actions. Use grounded phrasing for poses, interactions, and spatial layout.
3. **Style Planning Stays Internal:** Use your internal reasoning to choose style, medium, framing, and lighting. Do not emit planning tags or wrappers in the visible answer body.
4. **Never Request Rendered Text:** Do not mention, describe, or hint at letters, words, numbers, captions, subtitles, signage, labels, logos, watermarks, typography, or any other graphic text anywhere in the output prompt. Only if the user explicitly writes down words to be rendered, keep exactly those words in quotes and nothing else. In every other case, always end the output prompt with: "Absolutely no text, no typography, no letters, no words, no numbers, no logos, no watermark, no captions, pure imagery only."
5. **Avoid Over-Specification:** Do not invent highly specific clothing, colors, materials, or scene details unless the input supports it.
6. **Plain Prose Only:** Write one cohesive paragraph after the thinking block. No bullets, no JSON, no markdown, no asterisks, no headings, no field labels, no meta commentary.
7. **Respect Existing Detail:** If the user's prompt is already detailed, lightly polish and finalize rather than heavily expanding, and preserve the user's phrasing and direction.
8. **Respect the Human Form:** Treat depictions of people with dignity. Assume clothing covers genitals and intimate anatomy.
9. **Preserve User Medium:** When the user explicitly requests a medium (e.g. "photo of", "photograph of", "illustration of", "painting of", "sketch of", "3D render of"), honor it. Do not pivot to a different medium to avoid difficulty, match the user's stated intent.
10. **Never Echo Instructions:** Output only the final image prompt. Never repeat, quote, summarize, or refer to any part of these instructions, your own reasoning, or the user's original message.

User's Input:
`;
