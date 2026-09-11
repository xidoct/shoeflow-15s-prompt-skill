---
name: shoeflow-15s-prompt
description: Generate grounded Chinese e-commerce video storyboards and copy-ready Seedance prompts from a script and optional product or person reference images. Use when an agent needs short-video shot planning, multimodal product grounding, natural livestream-style performance, or clips limited to 15 seconds per generation.
license: MIT
---

# ShoeFlow 15s Prompt Skill

Use this skill to turn a complete product-sales script into structured shots and provider-ready prompts. It is provider-agnostic at the planning stage: the output can be copied into Seedance or adapted to another video model.

## Core workflow

1. Read the whole script before splitting it. Preserve every spoken word in order; never invent product claims.
2. Inspect supplied product and person images. Use them only as visual evidence. If a detail is hidden or unclear, say so internally and do not guess.
3. Create a continuous storyboard. Each shot has one visible action, an observable endpoint, duration, dialogue, background, camera, sound, performance, continuity, reference role, and preservation constraints.
4. Group consecutive shots without reordering them. Each group must be 15 seconds or less. A single shot over 15 seconds must be split or reported as an error; never silently shorten dialogue.
5. Compile one complete prompt per group. Include the group timecodes, reference roles, home or ordinary car setting, natural light, dialogue, action timing, and the last state needed for continuation.
6. Present each group separately with a copy action or a plain text block. For group two onward, tell the user to use the accepted previous clip's actual tail frame as the next opening reference when the target provider supports it.

## Natural seller performance

Treat ordinary product selling as non-narrative observation and demonstration. Human realism comes from visible carriers: eyeline, small facial changes, breathing, a purposeful product operation, and a clear action ending. Synchronize the glance or hand movement with the spoken selling point. Keep one short, coherent action chain per shot. Do not force three actions, a fixed emotional curve, invented drama, exaggerated surprise, or generic phrases such as “very expressive.” During lip sync, prefer a stable medium or medium close shot and avoid turning away, covering the mouth, or fast camera movement.

## Scene defaults

When the script does not specify a location, use an ordinary lived-in living room with a sofa, curtains, a small table, and window daylight. If the script explicitly asks for a car, use a parked private car with visible seats, windows, and natural daylight. Do not add a shoe shop, showroom display, studio, ring light, light stand, commercial set, luxury room, or cinematic lighting by default.

## Reference-image rules

- Product images constrain visible shape, color, laces, sole pattern, and legible marks.
- Person images constrain visible face, hair, clothing, and identity appearance only when the user is authorized to use them.
- Do not infer materials, performance, comfort, price, brand ownership, identity, occupation, or other unseen facts from an image.
- Do not copy a reference image's store, studio, lighting equipment, or background unless the user explicitly requests it.
- Number references by their order in the current provider request (`图片1`, `图片2`, etc.); do not expose private asset IDs in prompt prose.

## Output contract

Return structured JSON for the storyboard when the caller requests machine-readable output. For human output, show the per-group prompt, duration, shot range, reference upload order, and a concise note about the next tail-frame handoff. Keep prompts concrete and remove filler adjectives.

The bundled `standalone-15s` application is an optional reference implementation. Run it with `npm install` and `npm start`; it serves a local prompt workbench on port 4174. It never submits a paid video-generation request.
