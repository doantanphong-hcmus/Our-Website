# P1.2 — Character direction

- Status: Closed
- Date: 2026-08-29
- Art direction: original warm editorial comic, adult and mobile-first
- Character roles: `user-one` and `user-two`; display names remain profile data

## Shared visual language

- Stylized adult proportions around five heads tall: expressive enough at
  mobile size, but not chibi or childlike.
- Clean 2D shapes, warm charcoal linework, flat color with one restrained
  shadow layer and a subtle paper texture only where it helps the scene.
- Rounded corners and gentle curves match P1.1, without repeated hearts,
  glossy 3D effects, anime imitation or copyrighted character references.
- Faces use small, readable features and natural expressions. Hands and poses
  communicate the action instead of decorative effects.
- Both characters have equal visual weight, detail and narrative agency.

## Character one — rose / rounded

| Trait | Direction |
|---|---|
| Silhouette | Soft oval face, gently rounded shoulders, relaxed stance |
| Proportion | Five heads tall; slightly softer shapes, never childlike |
| Hair | Shoulder-length, softly wavy, side part |
| Hair color | Warm dark brown `#3a2c2b` |
| Signature shape | Circle used in small identity markers |
| Main color | P1.1 `--color-user-one` rose |
| Base outfit | Muted rose cardigan, cream inner top, warm beige straight trousers, simple neutral shoes |
| Movement | Open gestures, curved action lines, weight balanced rather than posed like a mascot |

## Character two — sage / structured

| Trait | Direction |
|---|---|
| Silhouette | Soft-rectangular face, straighter shoulders, calm stance |
| Proportion | Five-and-a-quarter heads tall; comparable on-screen size to character one |
| Hair | Short, clean side part with a slightly lifted front |
| Hair color | Near-black brown `#242126` |
| Signature shape | Rounded rectangle used in small identity markers |
| Main color | P1.1 `--color-user-two` sage |
| Base outfit | Sage overshirt, warm-white inner top, charcoal straight trousers, simple neutral shoes |
| Movement | Compact gestures, straighter action lines, relaxed rather than rigid |

Skin tone is deliberately not treated as an identity marker. The final P6.5
model sheet may tune facial and skin details from owner-approved references;
the two silhouettes, signature shapes and outfit colors remain stable.

## Expression set

Each character needs the same eight expressions:

1. Calm/neutral.
2. Soft smile.
3. Open laugh.
4. Thinking/curious.
5. Pleasant surprise.
6. Bashful but comfortable.
7. Concerned/supportive.
8. Celebrating.

Expressions must stay recognizable at a 64-pixel avatar crop and must not rely
on blush or color alone.

## Drawing the pair

- Default UI order is character one on the left and character two on the
  right. Comics may swap positions for composition, but signature shapes and
  colors stay visible.
- Keep eye lines within roughly five percent of the canvas height and keep
  both faces similarly sized; neither character permanently leads or towers.
- Shared moments use P1.1 `--color-shared` plum in props, background shapes or
  connecting lines, never by recoloring either character.
- Preferred pair poses: standing shoulder-to-shoulder, walking together,
  sitting across a small table, and jointly looking at one object.
- Affection is shown through proximity, eye line and small gestures. Avoid
  excessive hearts, exaggerated embarrassment and childish poses.
- Leave text-safe negative space above or beside the pair for 360–430 pixel
  screens; never place required copy over faces.

## Accessibility and production rules

- Rose/circle and sage/rounded-rectangle are always paired, so identity is not
  communicated by color alone.
- Avatar crops must work at 48, 64 and 96 pixels in light and dark themes.
- Comic masters must preserve transparent/background-separated layers so the
  final WebP/AVIF exports can be optimized for phones.
- Motion may animate a prop or a small pose change only; reduced motion uses a
  static final frame.
- Do not commit personal reference photos unless the owner explicitly approves
  their repository storage and access policy.

## P6.5 model-sheet acceptance

- Front and three-quarter view for both characters.
- Hair and base outfit match this brief across every view.
- All eight expressions exist for both characters.
- Four pair poses preserve equal visual weight and mobile text-safe space.
- Grayscale silhouette check still distinguishes circle/rounded character one
  from rounded-rectangle/structured character two.
- Owner approves any likeness-specific refinements before comic production.

P1.2 intentionally produces direction, not final artwork. Generating a model
sheet or holiday comic now would duplicate P6.5/P6.6 and risk rework before
owner-approved likeness references exist.
