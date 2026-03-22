import { useState, useRef, useEffect, useCallback } from "react";

// ── Design tokens ──────────────────────────────────────────────────────────
const C = {
  bg:          "#060810",
  surface:     "#0b0d18",
  card:        "#10121e",
  cardHover:   "#151828",
  border:      "#1e2238",
  borderHot:   "#3a3d5a",
  accent:      "#b8955a",
  accentBright:"#d4a96a",
  accentDim:   "#7a6035",
  accentGlow:  "rgba(184,149,90,0.12)",
  accentGlow2: "rgba(184,149,90,0.25)",
  text:        "#ede5d8",
  textSub:     "#9890a8",
  textDim:     "#4a4560",
  gold:        "#e8b84b",
  goldDim:     "#8a6a20",
  green:       "#3ec96a",
  red:         "#d94f4f",
  blue:        "#4a8fd4",
  purple:      "#7a5fd4",
  cyan:        "#3ec9c9",
  matrix:      "#00ff41",
};

const fH = "'Cormorant Garamond','Georgia',serif";
const fB = "'DM Sans','Helvetica Neue',sans-serif";
const fM = "'JetBrains Mono','Courier New',monospace";

const clamp = (v,a,b) => Math.max(a, Math.min(b, v));

function scoreColor(s) {
  if (s >= 94) return "#FFD700";       // Elite — pure gold
  if (s >= 88) return "#00FF88";       // Very Attractive — electric green
  if (s >= 80) return "#FFEA00";       // Attractive — neon yellow
  if (s >= 72) return "#FF9500";       // Good Looking — vivid orange-amber
  if (s >= 62) return "#C8A46A";       // Above Average — warm tan
  if (s >= 48) return "#8888AA";       // Average — cool grey-purple
  if (s >= 32) return "#FF6030";       // Below Average — hot orange-red
  return "#FF2244";                    // Unattractive — vivid red
}
function scoreLabel(s) {
  if (s >= 94) return "Elite";
  if (s >= 88) return "Very Attractive";
  if (s >= 80) return "Attractive";
  if (s >= 72) return "Good Looking";
  if (s >= 62) return "Above Average";
  if (s >= 48) return "Average";
  if (s >= 32) return "Below Average";
  if (s >= 16) return "Unattractive";
  return "Very Unattractive";
}

// ── Convert image file to base64 ─────────────────────────────────────────
function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

function dataUrlToBase64(dataUrl) {
  return dataUrl.split(",")[1];
}

// ── Claude Vision API call ────────────────────────────────────────────────
async function callClaude(messages, systemPrompt, maxTokens = 2000) {
  const body = {
    model: "claude-sonnet-4-20250514",
    max_tokens: maxTokens,
    system: systemPrompt,
    messages,
  };
  const resp = await fetch("https://biomax-backend.onrender.com/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`API error ${resp.status}: ${err}`);
  }
  const data = await resp.json();
  return data.content.filter(b => b.type === "text").map(b => b.text).join("");
}

// ── JSON repair ───────────────────────────────────────────────────────────
function repairJSON(raw) {
  let s = raw.replace(/```json|```/g, "").trim();
  s = s.replace(/,\s*$/, "");
  let braces = 0, brackets = 0, inString = false, escape = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escape) { escape = false; continue; }
    if (c === "\\" && inString) { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === "{") braces++;
    else if (c === "}") braces = Math.max(0, braces - 1);
    else if (c === "[") brackets++;
    else if (c === "]") brackets = Math.max(0, brackets - 1);
  }
  if (inString) s += '"';
  s = s.replace(/,\s*$/, "");
  for (let i = 0; i < brackets; i++) s += "]";
  for (let i = 0; i < braces; i++) s += "}";
  return s;
}

function safeParseJSON(text) {
  // Strip markdown code fences
  let clean = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

  // Try direct parse first
  try { return JSON.parse(clean); } catch {}

  // Try to find the outermost JSON object
  const firstBrace = clean.indexOf("{");
  const lastBrace = clean.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const extracted = clean.slice(firstBrace, lastBrace + 1);
    try { return JSON.parse(extracted); } catch {}
    try { return JSON.parse(repairJSON(extracted)); } catch {}
  }

  // Try repair on full text
  try { return JSON.parse(repairJSON(clean)); }
  catch (e) { throw new Error("Could not parse API response. " + e.message); }
}

// ── Validate image ────────────────────────────────────────────────────────
async function validateImage(base64, mediaType, photoType) {
  const prompt = `You are a strict image validator for a professional looksmaxxing analysis app.

Examine this image and determine:
1. Is this a REAL photograph of an actual human being (not a drawing, cartoon, AI-generated image, mannequin, statue, animal, object, landscape)?
2. Is it appropriate for the requested photo type: "${photoType}"?

Photo type requirements:
- "Face Frontal": Clear front-facing view of a real human face
- "Side Profile": Side view of a real human head/face
- "Torso": Upper body of a real human
- "Full Body": Full or near-full body shot of a real human

Respond ONLY with valid JSON:
{
  "isRealHuman": true/false,
  "isCorrectType": true/false,
  "reason": "brief explanation if rejected",
  "confidence": 0.0-1.0
}`;
  try {
    const text = await callClaude([{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
        { type: "text", text: prompt }
      ]
    }], "You are a strict image validator. Only respond with valid JSON.", 300);
    const clean = text.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch {
    return { isRealHuman: false, isCorrectType: false, reason: "Could not validate image", confidence: 0 };
  }
}

// ── Build image content ───────────────────────────────────────────────────
function buildImageContent(photos, goals, userInfo, photoContext = "selfie") {
  const imageContent = [];
  const photoLabels = { frontal:"FRONTAL FACE", profile:"SIDE PROFILE", torso:"TORSO", body:"FULL BODY" };
  for (const [key, label] of Object.entries(photoLabels)) {
    if (photos[key]) {
      imageContent.push({ type:"image", source:{ type:"base64", media_type:photos[key].mediaType, data:photos[key].base64 } });
      imageContent.push({ type:"text", text:`[${label} PHOTO]` });
    }
  }
  const infoStr = userInfo
    ? (() => {
        const htCm = userInfo.height || 170;
        const totalIn = Math.round(htCm / 2.54);
        const ft = Math.floor(totalIn/12), inch = totalIn%12;
        const kg = Math.round((userInfo.weight||160) * 0.4536);
        return `Age: ${userInfo.age||25} years, Height: ${htCm}cm (${ft}'${inch}"), Weight: ${userInfo.weight||160}lbs (${kg}kg).`;
      })()
    : "";
  const ctxNote = photoContext === "selfie"
    ? "PHOTO CONTEXT: These are SELFIE photos taken with a front-facing smartphone camera. Apply modest selfie lens compensation (+2 to +4 points only). Score the real face honestly — do not over-inflate."
    : photoContext === "mirror"
    ? "PHOTO CONTEXT: These are mirror selfies taken with a rear camera. Minimal distortion. Apply +1 to +2 correction at most. Score honestly."
    : "PHOTO CONTEXT: These appear to be professional or high-quality photos taken with a proper camera at distance. Score as seen with minimal compensation needed.";
  imageContent.push({ type:"text", text:`${infoStr} User goals and concerns: "${goals || "General improvement"}". ${ctxNote}` });
  return imageContent;
}

const SYS = `You are an elite facial aesthetics analyst who scores faces the way a professional casting director would — with full command of the entire 1-100 range. You give HIGH scores to genuinely attractive faces and LOW scores to genuinely unattractive ones. You do not cluster or default to the middle.

CRITICAL — SELFIE DISTORTION COMPENSATION: Most photos you receive are selfies taken at arm's length with a wide-angle smartphone lens. Selfies systematically distort faces: they flatten cheekbones, widen the nose by 30%, make the chin appear weaker, exaggerate skin pores, and create unflattering shadows. A person who looks average in a selfie is often above average in real life. You MUST mentally compensate for this distortion. When you see a selfie, ask: "What would this face look like in a professional photo taken at 5+ feet with a 50-85mm lens?" Score that face — not the selfie distortion.

A good-looking person who would be noticed on the street scores 70-80. An objectively attractive person scores 80-90. A model scores 90+. An average person scores 48-60. You detect skin concerns precisely. Respond ONLY with valid compact JSON.`;

const SCORING_RUBRIC = `
SMV SCORING SCALE — memorise these anchor points before scoring:

ALL scores must be EVEN numbers only: 2,4,6,8,10,12,14,16,18,20,22,24,26,28,30,32,34,36,38,40,42,44,46,48,50,52,54,56,58,60,62,64,66,68,70,72,74,76,78,80,82,84,86,88,90,92,94,96,98,100.

ANCHOR POINTS — these are fixed reference scores. Do not deviate from what the face actually is:
10:  Severely disfigured. Extreme genetic or injury-based asymmetry.
24:  Clearly unattractive. Recessed chin, poor bone structure, skin issues compounding.
38:  Below average. Weak jaw, soft features, forgettable. Nothing stands out positively.
50:  Perfectly average. The median face on the street. Neither attractive nor unattractive.
62:  Noticeably above average. You'd look twice. 1-2 strong features elevate the face.
72:  Good looking. Clearly attractive to most people. Strong bone structure or striking features.
80:  Objectively attractive. Would be called handsome/beautiful by nearly everyone. Few weaknesses.
88:  Very attractive. Model-adjacent. Striking face, nearly no structural weaknesses.
94:  Elite. Professional model tier. Exceptional by any global standard.
100: Genetic perfection. Effectively does not exist.

SCORING RULES — read every word:
1. SELFIE COMPENSATION RULE: Smartphone selfies distort the face slightly. Apply a modest +2 to +4 correction only — do NOT over-inflate. Score the real face honestly.
2. USE THE FULL RANGE 20–100. The distribution should be wide, not clustered. Genuinely average faces score 44–54. Good-looking scores 68–76. Very attractive 80–88. Elite 90+.
3. DO NOT cluster scores in the 58–70 band. This is the single biggest error. If you are assigning a score in that range, justify it specifically — if the face has multiple structural weaknesses, it belongs at 30–50. If it has genuine strengths, it belongs at 72–82.
4. LOW SCORES ARE VALID AND NECESSARY. A face with a recessed chin, poor symmetry, weak jawline, and multiple weaknesses should score 26–46. Score it there. This is not mean — it is honest.
5. HIGH SCORES FOR HIGH-END FACES. A genuinely beautiful face (model, actress, someone universally considered attractive) should score 84–94. Do not suppress elite faces to 72–78 out of caution. If a face has 3+ elite features (sharp jaw, high cheekbones, positive canthal tilt, symmetry) it belongs in the 82–92 range. Above 94 is reserved for once-in-a-generation faces.
6. faceScores must span at least 36 points between the best and worst metric. Real faces have clear strengths and weaknesses — do not compress everything into a tight band.
7. ALL scores must be even numbers. Round odd numbers up to nearest even.`;

// -- Call 1: Deep face + body scanning (images) --
async function analyseScores(photos, goals, userInfo, photoContext = "selfie") {
  const imageContent = buildImageContent(photos, goals, userInfo, photoContext);

  const prompt = `${SCORING_RUBRIC}

TASK: Score this person's SMV and facial metrics from the photo(s).

Before outputting JSON, conduct this forensic scan:

PRE-SCORE ASSESSMENT (answer these mentally before picking a number):
Q0: PHOTO TYPE — Is this a selfie (arm-length, front-facing camera, wide-angle distortion visible)? If yes, mentally correct for lens distortion before assessing any feature. Widen the cheekbones, narrow the nose, sharpen the chin, and smooth apparent skin texture in your mental model. A selfie makes an 8/10 face look like a 6/10.
Q1: Name the single BEST structural feature. Be specific — "sharp gonial angle", "positive canthal tilt", "high zygomatic projection".
Q2: Name the single WORST structural feature. Be specific — "recessed mandible", "negative canthal tilt", "wide nasal base".
Q3: Would a random person on the street find this face attractive? 
    → Definitely yes, striking/model-tier = start at 82-90, then adjust for specific feature quality
    → Most people yes = start at 64-74
    → Mixed reactions = start at 48-62
    → Most people no = start at 30-46
    → Clearly unattractive = start at 18-30
Q4: Do multiple weaknesses compound each other? Each compounding negative drops the score 4-8 pts.
Q5: Are there elite-tier features (exceptional jaw, rare symmetry, striking eyes)? Each genuine elite feature adds 4-8 pts.
Q6: SELFIE ADJUSTMENT — If this was a selfie, apply a modest +2 to +4 correction only.
Q7: SPREAD CHECK — Is my score between 54-68? Stop. Is this face genuinely above average with real structural strengths? If not, it may belong lower (38-52). Is it clearly above average? Then push it to 70-80. Do not default to the middle band.

SKIN FORENSICS (scan carefully for ALL of these):
- Acne: active breakouts? cystic? comedonal? Where exactly on face?
- Post-acne: scarring, hyperpigmentation, ice-pick scars, rolling scars?
- Stretch marks: visible on body photos? Where? Severity?
- Skin texture: pores enlarged? bumpy? rough? orange-peel?
- Puffiness: suborbital bags? facial water retention? jawline bloat?
- Dark circles: pigment or hollowing or both?
- Redness/rosacea: diffuse redness? broken capillaries?
- Hyperpigmentation: sun spots, melasma, uneven tone?
- Other: moles, skin tags, visible scarring from injury?

List EVERY visible concern in detectedConcerns — be exhaustive, this drives the entire personalised plan.

Biometrics: Age ${userInfo?.age||"unknown"}, Height ${userInfo?.height||"unknown"}, Weight ${userInfo?.weight||"unknown"}. Goals/concerns: "${goals || "none"}"

Return ONLY this JSON with REAL scores:
{"overallScore":0,"smvLabel":"Average","summary":"NAME the best feature AND worst feature specifically in 2 sentences","detectedConcerns":[],"faceScores":{"symmetry":0,"canthalTilt":0,"goldenRatio":0,"facialThirds":0,"jawDefinition":0,"cheekboneProminence":0,"eyeArea":0,"noseHarmony":0,"lipProportion":0,"skinQuality":0,"neckJaw":0},"faceObservations":{"symmetry":"specific observation","canthalTilt":"positive/negative/neutral + degree","goldenRatio":"which measurement deviates","facialThirds":"which third is long/short/balanced","jawDefinition":"gonial angle, border sharpness, masseter","cheekbones":"forward/lateral projection, zygomatic prominence","eyeArea":"shape, tilt, orbital depth, under-eye","nose":"bridge width, tip, nostril flare","lips":"upper-to-lower ratio, cupid bow, corners","skin":"pores, texture, acne/scarring, tone","profile":"chin, neck angle — only if side photo"},"bodyScores":{"overallComposition":0,"posture":0,"shoulderToWaist":0,"muscleDevelopment":0,"legDevelopment":0},"bodyObservations":{"composition":"body fat estimate, muscle visibility","posture":"specific issues or strengths","frame":"shoulder-to-waist ratio","muscularity":"visible groups, what is lacking","legs":"lower body development"}}

FINAL CALIBRATION CHECK — complete every step before outputting:
1. Is overallScore an EVEN number? If odd, round UP to nearest even.
2. Are ALL faceScores even? Round any odds up.
3. SELFIE CHECK: Was this photo taken at arm's length with a front camera? If yes, apply +2 to +4 correction only.
4. SPREAD CHECK: Is overallScore between 54-68? Ask: does this face have genuine, specific structural strengths? If yes, push to 70+. If it has multiple weaknesses, push it down to 36-52. Do not park in the middle band by default.
5. faceScores span: best score minus worst score must be at least 36. Force this — widen the gap between the best and worst metric.
6. smvLabel must exactly match:
   - overallScore 2-30   → "Unattractive"
   - overallScore 32-46  → "Below Average"  
   - overallScore 48-60  → "Average"
   - overallScore 62-70  → "Above Average"
   - overallScore 72-78  → "Good Looking"
   - overallScore 80-86  → "Attractive"
   - overallScore 88-92  → "Very Attractive"
   - overallScore 94-100 → "Elite"
7. detectedConcerns: list only visible skin/hair concerns (acne, scarring, puffiness, dark circles, texture issues). Leave array empty [] if skin is genuinely clear. Do NOT penalise for skin texture that may be an artifact of selfie camera compression.`;

  return withRetry(() =>
    callClaude([{ role:"user", content:[...imageContent, { type:"text", text:prompt }] }], SYS, 3000)
      .then(safeParseJSON)
  );
}

async function withRetry(fn, maxAttempts = 2) {
  let lastErr;
  for (let i = 0; i < maxAttempts; i++) {
    try { return await fn(); }
    catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 800)); }
  }
  throw lastErr;
}

// ── Call 2a: Exercises + Protocols (text-only, no images re-sent) ─────────
async function analyseExercisesProtocols(goals, scoresData, userInfo) {
  const concerns = (scoresData.detectedConcerns||[]).join(", ") || "general improvement";
  const bio = userInfo ? (() => {
    const htCm = userInfo.height || 170;
    const totalIn = Math.round(htCm / 2.54);
    const ft = Math.floor(totalIn/12), inch = totalIn%12;
    const kg = Math.round((userInfo.weight||160) * 0.4536);
    return `Age: ${userInfo.age||25}yrs, Height: ${htCm}cm (${ft}'${inch}"), Weight: ${userInfo.weight||160}lbs (${kg}kg).`;
  })() : "";
  const ctx = `${bio} Person summary: ${scoresData.summary}. Detected concerns: ${concerns}. Goals: ${goals||"general"}.`;

  const prompt = `${ctx}

You are a precision biohacking analyst. Your job is to prescribe EXACTLY 5 exercises and EXACTLY 3 protocols that are laser-targeted to this specific person's detected concerns listed above.

CRITICAL: Do NOT give generic advice. Every single exercise and protocol must be chosen BECAUSE of a specific detected concern. If acne/scarring detected → prescribe skin exercises. If jaw weak → mewing + masseter. If puffiness → lymphatic drainage + craniosacral facial decompression. If hair thinning → scalp exercises. If stretch marks visible → prescribe targeted treatment. If skin texture poor → prescribe specific technique. If ANY facial asymmetry detected (one side higher, jaw angled, eye size difference, cheek imbalance, uneven smile, SCM dominance) → prescribe from ASYMMETRY CORRECTION category: weak-side zygomaticus activation, bilateral palate loading, lateral pterygoid rebalancing, SCM lengthening, C1-C2 mobilization. If puffiness OR mid-face compression OR forehead tension → prescribe from CRANIOSACRAL & FASCIAL DECOMPRESSION: palate release, nasal bridge decompression, zygomatic expansion. Use anatomically precise language in howTo steps.

Expanded technique library — draw from ALL of these:

JAW & CRANIOFACIAL:
- Mewing (proper tongue posture against entire palate — not just tip)
- Mastic gum chewing (2hr+ daily, asymmetric chew to balance)
- Masseter hypertrophy protocol (jaw clenches with resistance, 3x daily)
- Chin tuck + forward head correction (decompresses cervical spine, improves profile)
- Canine fossa activation (cheek hollow exercise — suck inner cheeks against teeth for 30s)
- Hyoid bone positioning (chin-to-chest swallow hold, nod head up while swallowing)
- Hollow cheek protocol (body fat below 12%, mewing + canine fossa + dehydration timing)
- Gonial angle training (hard chewing foods — carrots, raw meat, mastic gum)
- Neck thickness training (neck bridges, plate neck curls, wrestler's bridge)
- Orbicularis oculi tightening (close eyes firmly, hold 5s, release — lifts under-eye area)
- Zygomaticus activation (genuine smile hold 10s, repeat 15x — lifts malar fat pad)
- Brow bone & frontalis relaxation (finger pressure while brow-raising, smooths forehead)

FASCIA & SOFT TISSUE:
- Buccal massage / intraoral fascia release (gloves, release internal cheek restriction)
- Jaw fascia release (temple + masseter effleurage, 2 min per side)
- Gua sha (lymphatic + bone contouring along jaw, cheekbones, neck)
- Forehead sweep (fingers spread outward releasing frontalis, prevents lines)
- Suboccipital release (base of skull decompression — corrects forward head, opens jaw)
- Temporomandibular joint release (opening stretch + lateral glide, reduces puffiness)

POSTURE & STRUCTURE:
- Wall angel protocol (thoracic extension, shoulder retraction against wall daily)
- Deep cervical flexor activation (chin tuck + nod — corrects forward head posture)
- Hip flexor lengthening (couch stretch — improves upright stance and neck posture)
- Thoracic extension over foam roller (opens chest, reverses desk-hunching)
- Dead hang (spinal decompression, shoulder alignment, neck lengthening)

SKIN & RECOVERY:
- Ice globing (cold globes under eyes + over jaw — reduces inflammation + tightens)
- Gua sha (jade/metal tool, lymphatic drainage along jaw and neck)
- Dermarolling (0.25mm for absorption, 0.5mm for collagen — once per week)
- Cold water face plunge (10-15°C, 60 seconds morning — vasoconstric + pore tightening)
- Lymphatic facial drainage (light upward strokes from chin to ear, daily)
- LED red light therapy (630-660nm, 10 min daily — stimulates collagen, reduces redness)

HAIR & SCALP:
- Scalp microneedling (dermaroller 0.5mm on scalp + pumpkin seed oil or saw palmetto serum applied after)
- Inversion method (hang head below heart 4 min — increases scalp blood flow)
- DHT-blocking scalp massage (ketoconazole shampoo + rosemary oil, 5 min daily)

EYES & CANTHAL TILT:
- Orbicularis oculi exercise (firm close, hold 5s — lifts lower lid, reduces bags)
- Lateral eye pressure (fingertip at outer corner, pull slightly while squinting — trains lateral canthus)
- Under-eye depuffing (cold spoons + lymphatic massage outward toward temples)

ASYMMETRY CORRECTION — NEUROMUSCULAR & CRANIAL (prescribe if ANY asymmetry detected):
- Weak-side zygomaticus/risorius activation (lift corner of mouth on weaker side ONLY, hold 10s × 10 reps — unilaterally targets under-recruited zygomaticus major and risorius to correct neuromuscular imbalance)
- Malar fat pad lift with proprioceptive resistance (place finger on weaker zygoma, smile while pushing malar fat pad superiorly against finger, hold 5s × 12 reps — restores bilateral zygomatic arch symmetry)
- Bilateral palate loading protocol (press entire tongue flush against hard palate with conscious equal left-right pressure distribution, hold 30s × 5 sets — corrects asymmetric maxillary loading that drives uneven mid-face development; uneven tongue pressure is the #1 driver of acquired cheekbone asymmetry)
- Lateral pterygoid rebalancing drill (translate mandible slightly anterior then actively midline it against its habitual drift toward the dominant masseter side, hold 5s × 10 reps — trains bilateral pterygoid co-contraction and corrects condylar asymmetry)
- Sternocleidomastoid (SCM) lengthening stretch (lateral cervical flexion toward dominant side, gentle overpressure at temporal-occipital junction, hold 25s × 3 sets — decompresses the atlanto-occipital joint and releases unilateral SCM hypertonicity which directly rotates the calvaria and pulls the facial skeleton off-axis)
- Weak-side masseter hypertrophy protocol (unilateral mastic gum chewing on hypotrophic side 15 min daily — corrects masseter volume asymmetry at the gonial angle; stop once bilateral symmetry is achieved)
- Mirror neurofeedback training (activate weak-side facial musculature while monitoring in mirror — visual biofeedback accelerates motor cortex remapping and neuromuscular re-recruitment of the hypoactive side)
- Sleep posture correction (alternate lateral decubitus position nightly or transition to supine — prolonged unilateral pressure from the pillow causes progressive periosteal remodeling and soft tissue redistribution)

CRANIOSACRAL & FASCIAL DECOMPRESSION (prescribe for puffiness, mid-face compression, forehead tension, sinus tightness):
- Soft palate release / intraoral maxillary lift (clean gloved finger inside mouth, press gently upward against soft palate and sweep laterally — decompresses the maxillary and palatine bones, reduces nasomaxillary complex compression, improves mid-face lymphatic drainage; grounded in craniosacral therapy principles)
- Nasal bridge decompression (bilateral finger placement along nasal bridge / nasion, gentle superior traction — releases periosteal tension over the nasal bones and ethmoid, reduces inter-orbital compression and sinus congestion)
- Zygomatic arch lateral expansion (fingers along zygomatic arch, gentle superior-lateral tissue mobilization — counteracts medial compression of the malar complex, increases apparent mid-face width and reduces puffiness over the zygomaticomaxillary suture)
- Frontal bone / supraorbital decompression (fingertips on frontal bone, slow superolateral sweep — releases tension in the frontalis, corrugator supercilii, and procerus; reduces supraorbital pressure and brow heaviness; targets the coronal suture and glabella region)
- Cranial nervous system downregulation (slow diaphragmatic breathing 4-count inhale / 6-count exhale before and after manual techniques — activates parasympathetic tone via vagal afferents, reduces cortisol-driven facial puffiness and fascial hypertonicity that resists manual release)

CERVICAL SPINE & DEEP STRUCTURAL (for forward head, neck asymmetry, profile improvement):
- C1–C2 atlanto-axial rotation mobilization (gentle self-SNAG: chin tuck + slow rotation to restricted side, hold 3s × 8 reps — addresses hypomobility at the atlanto-axial joint, the most common cervical driver of facial and cranial asymmetry)
- Deep cervical flexor (DCF) activation — longus colli & longus capitis (chin tuck with cranial nod, hold 10s × 10 reps — strengthens the deep cervical flexors which stabilize C0–C2 and correct anterior head translation; forward head posture of just 2.5cm doubles effective head weight on the cervical spine and distorts the facial resting position)
- Suboccipital muscle release (bilateral suboccipital inhibition: cradle occiput in hands, apply gentle sustained traction for 90s — decompresses the rectus capitis posterior and obliquus capitis, releasing cranial base tension that affects TMJ mechanics and facial symmetry)

Return ONLY valid compact JSON, no markdown:
{"exercises":[{"category":"Craniofacial","icon":"🏋️","priority":"High","title":"Specific name","laymanTitle":"Plain English name e.g. 'Jaw Push Exercise'","targetedAt":"exact concern this fixes","laymanTarget":"plain English e.g. 'fixes your uneven jawline'","why":"why this specific person needs this under 30 words","startPosition":"Starting position e.g. 'Sit upright in a chair, feet flat, spine straight'","howTo":"1. Step one\n2. Step two\n3. Step three\n4. Step four","sets":"e.g. 3x daily, 2 min","timeframe":"8 weeks","difficulty":"Easy","scorePotential":3}],"protocols":[{"category":"Skin","icon":"🧴","priority":"High","title":"Protocol name","laymanTitle":"Plain English name","why":"why this exact concern needs this under 25 words","how":"Specific steps under 60 words","timeframe":"4 weeks","difficulty":"Easy"}]}

MANDATORY:
- Exactly 5 exercises, exactly 3 protocols. Include at least 1 Eyes category exercise if any eye concern detected. Include at least 1 Posture category exercise always.
- category field MUST be EXACTLY one of these values (case-sensitive): "Craniofacial", "Asymmetry", "Craniosacral", "Cervical", "Fascia", "Posture", "Skin", "Eyes", "Hair", "Body", "Recovery" — do NOT use any other category name
- Each must directly reference one of the detected concerns above
- howTo must be numbered steps, not prose
- startPosition is REQUIRED: always describe exactly where the person starts — e.g. "Sit upright in a chair with feet flat on the floor and spine tall", "Lie on your back on a flat surface with knees bent", "Stand facing a mirror with feet shoulder-width apart"
- laymanTitle: plain English equivalent of the anatomical title, max 5 words
- laymanTarget: plain English of what it fixes, max 10 words  
- why must be specific to THEIR concern, not generic
- scorePotential: realistic score increase per exercise. IMPORTANT: if the person's overallScore is 80+, cap each exercise's scorePotential at 2 pts max (elite faces have little room to improve). If 70-79, cap at 3 pts. If below 70, up to 5 pts per exercise. Honest per-exercise ranges: mewing = +1 to +3; dermarolling = +1 to +2; jaw training = +1 to +3; eye exercises = +1 to +2; asymmetry protocol = +1 to +3; cervical correction = +1 to +2; SCM release = +1 to +2.
- Use anatomically precise terminology in howTo steps where relevant (e.g. zygomaticus major, lateral pterygoid, sternocleidomastoid, atlanto-occipital junction, maxillary suture, orbicularis oculi, longus colli).`;

  return withRetry(() =>
    callClaude([{ role:"user", content: prompt }], SYS, 2800)
      .then(safeParseJSON)
  );
}

// ── Call 2b: Routines + Supplements (text-only) ───────────────────────────
async function analyseRoutinesStack(goals, scoresData, userInfo) {
  const concerns = (scoresData.detectedConcerns||[]).join(", ") || "general improvement";
  const bio = userInfo ? (() => {
    const htCm = userInfo.height || 170;
    const totalIn = Math.round(htCm / 2.54);
    const ft = Math.floor(totalIn/12), inch = totalIn%12;
    const kg = Math.round((userInfo.weight||160) * 0.4536);
    return `Age: ${userInfo.age||25}yrs, Height: ${htCm}cm (${ft}'${inch}"), Weight: ${userInfo.weight||160}lbs (${kg}kg).`;
  })() : "";
  const ctx = `${bio} Person summary: ${scoresData.summary}. Detected concerns: ${concerns}. Goals: ${goals||"general"}.`;

  const prompt = `${ctx}

You are a precision biohacking looksmaxx coach. Build a focused morning/evening routine and supplement stack.

CRITICAL — ALL supplements and routine products must be over-the-counter (OTC) and legally available in Canada without a prescription. Do NOT recommend finasteride, minoxidil (oral), tretinoin, retinoids, or any Rx-only medication.

ROUTINE DESIGN RULES (strictly follow):
- Morning routine MUST focus on: lymphatic drainage first (always), then postural reset, then one concern-specific step
- Evening routine MUST focus on: fascial release / craniosacral techniques, skin repair, and recovery
- Routines must NOT duplicate exercises from the exercise plan. Routine steps are quick daily habits (30–120 sec each), NOT workouts
- Each step must include where to do it and how to position the body (e.g. "standing at sink", "lying in bed before rising")
- If puffiness / debloat detected → gua sha lymph drain + elevated sleeping position + diuretic supplement
- If acne detected → acne-targeting steps and supplements. If hair loss → saw palmetto + biotin OTC stack
- If stretch marks → collagen/repair supplements. If skin texture → retinol in evening
- Match everything to what was actually found in the concerns list.

Return ONLY valid compact JSON, no markdown:
{"morningRoutine":{"steps":[{"action":"Action name","position":"Where body is e.g. standing at sink, lying in bed","detail":"What to do exactly — specific to their concerns, under 40 words","why":"why this under 20 words"}]},"eveningRoutine":{"steps":[{"action":"Action name","position":"Where body is e.g. sitting on floor, lying down","detail":"What to do exactly — specific to their concerns, under 40 words","why":"why this under 20 words"}]},"supplementStack":[{"name":"Supplement name","dose":"exact dose","timing":"morning/evening/with food","benefit":"specific benefit for their detected concerns under 20 words","priority":"Essential","targets":"exact concern it targets"}]}

MANDATORY:
- Exactly 3 morning steps, exactly 3 evening steps (no time, no duration — just action/detail/why)
- Exactly 10 supplements ordered Essential first, then Recommended, then Optional
- Every step and supplement must address one of the detected concerns
- Hair loss detected → saw palmetto 320mg + biotin 5000mcg + zinc 30mg as Essential
- Acne/breakouts detected → zinc picolinate 30mg + topical niacinamide + spearmint
- Stretch marks detected → collagen peptides 15g + vitamin C 1000mg + rosehip oil (all OTC in Canada)
- Puffiness detected → morning lymphatic drainage step + potassium supplement
- ALWAYS include: magnesium glycinate 400mg (sleep/recovery), vitamin D3 5000IU+K2`;

  return withRetry(() =>
    callClaude([{ role:"user", content: prompt }], SYS, 2200)
      .then(safeParseJSON)
  );
}

// ── Main analysis: call 1 sequential, calls 2a+2b parallel ───────────────
function sanitiseScores(data) {
  // Enforce even numbers on every numeric score field
  const toEven = v => (typeof v === "number") ? (v % 2 === 0 ? v : v + 1) : v;
  if (data.overallScore !== undefined) data.overallScore = toEven(data.overallScore);
  if (data.faceScores) Object.keys(data.faceScores).forEach(k => { data.faceScores[k] = toEven(data.faceScores[k]); });
  if (data.bodyScores) Object.keys(data.bodyScores).forEach(k => { data.bodyScores[k] = toEven(data.bodyScores[k]); });
  return data;
}

async function runFullAnalysis(photos, goals, userInfo, onProgress, photoContext = "selfie") {
  onProgress(10, "Scanning facial geometry & features…");
  const part1 = sanitiseScores(await withRetry(() => analyseScores(photos, goals, userInfo, photoContext)));

  onProgress(45, "Generating exercises, protocols, routines & stack in parallel…");

  // Run calls 2a and 2b concurrently — much faster
  const [part2a, part2b] = await Promise.all([
    analyseExercisesProtocols(goals, part1, userInfo),
    analyseRoutinesStack(goals, part1, userInfo),
  ]);

  onProgress(95, "Compiling your biohack report…");
  return { ...part1, ...part2a, ...part2b };
}

// ══════════════════════════════════════════════════════════════════════════
// UI COMPONENTS
// ══════════════════════════════════════════════════════════════════════════

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;0,700;1,300;1,400&family=DM+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #060810; color: #ede5d8; font-family: 'DM Sans','Helvetica Neue',sans-serif; }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: #0b0d18; }
  ::-webkit-scrollbar-thumb { background: #b8955a; border-radius: 2px; }
  @keyframes ringBurst {
  0%   { transform: scale(1);   opacity: 1; }
  100% { transform: scale(1.8); opacity: 0; }
}
@keyframes fadeUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
  @keyframes pulse { 0%,100%{opacity:.3;transform:scale(.85)} 50%{opacity:1;transform:scale(1.1)} }
  @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
  @keyframes shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
  @keyframes glow { 0%,100%{box-shadow:0 0 20px rgba(184,149,90,0.12)} 50%{box-shadow:0 0 40px rgba(184,149,90,0.25)} }
  @keyframes matrixRain { 0%{opacity:1;transform:translateY(-20px)} 100%{opacity:0;transform:translateY(20px)} }
  @keyframes codeFlicker { 0%,100%{opacity:1} 50%{opacity:0.7} 92%{opacity:1} 93%{opacity:0.2} 94%{opacity:1} }
  @keyframes scanLine { 0%{transform:translateY(-100%)} 100%{transform:translateY(400%)} }
  @keyframes decode { 0%{letter-spacing:0.3em;opacity:0.4} 100%{letter-spacing:0.08em;opacity:1} }
  @keyframes ringPulse { 0%,100%{filter:drop-shadow(0 0 4px rgba(184,149,90,0.3))} 50%{filter:drop-shadow(0 0 16px rgba(184,149,90,0.6))} }
  @keyframes hexRotate { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
`;

// ── Biohacking Loading Ring ───────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════
// LOADING TIP — rotates through daily habit tips during analysis
// ══════════════════════════════════════════════════════════════════════════
const LOADING_TIPS = [
  { label:"🚫 Chewing on one side",       tip:"Chew bilaterally — unilateral masseter loading drives gonial + zygomatic asymmetry over time." },
  { label:"🚫 Sleeping on the same side", tip:"Alternate sides or go supine — unilateral pillow pressure causes periosteal remodeling over time." },
  { label:"🚫 Head resting on one hand",  tip:"Keep your head centered — habitual lateral loading shifts the condylar resting position." },
  { label:"🚫 Phone below eye level",     tip:"Raise your screen to eye level — each 2.5cm of forward head translation doubles cervical load and drags the facial skeleton forward." },
  { label:"🚫 Mouth breathing at rest",   tip:"Nasal breathing maintains negative intraoral pressure that supports the palate and maxillary arch." },
  { label:"🚫 Jaw clenching under stress",tip:"Conscious jaw drop + tongue-to-palate rest position reduces hyperactive pterygoid and masseter tone that compresses the TMJ." },
  { label:"💡 Mew correctly",            tip:"Full tongue on the palate — not just the tip. Posterior third contact is what drives maxillary expansion and midface development." },
  { label:"💡 Fix your sleep posture",   tip:"Your face spends 6–8 hours compressed against a pillow every night. That's more contact time than any exercise you'll do." },
  { label:"💡 Nasal breathing at night", tip:"Mouth taping at night trains nasal breathing, improves oxygen efficiency, and prevents the palate narrowing associated with oral breathing." },
  { label:"💡 C1–C2 rotation matters",   tip:"Most facial asymmetry originates at the atlanto-axial joint. A restricted C1–C2 rotation pulls the entire cranial base off-axis." },
  { label:"💡 Consistency compounds",    tip:"Facial remodeling is driven by sustained mechanical load over weeks. One day of mewing does nothing. 90 days changes bone." },
  { label:"💡 Masseter hypertrophy",     tip:"Chewing mastic gum on the weaker side for 15 min/day closes masseter volume asymmetry at the gonial angle within 4–8 weeks." },
];

// ── PAYWALL OVERLAY ────────────────────────────────────────────────────────
// Shared section card style — used by PaywallOverlay and results tabs
const sec = { background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:"14px", marginBottom:14 };

// PaywallOverlay: heading stays visible, content rows are blurred, CTA floats below
function PaywallOverlay({ onUnlock, heading, subheading, icon }) {
  return (
    <div style={{ animation:"fadeUp .4s ease both" }}>
      {/* Visible heading — not blurred */}
      <div style={{ ...sec, marginBottom:0, paddingBottom:16 }}>
        {icon && (
          <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:10 }}>
            <span style={{ fontSize:28 }}>{icon}</span>
            <h3 style={{ fontFamily:fH, fontSize:24, color:C.text, margin:0 }}>{heading}</h3>
          </div>
        )}
        {!icon && heading && (
          <h3 style={{ fontFamily:fH, fontSize:20, color:C.text, marginBottom:4 }}>{heading}</h3>
        )}
        {subheading && (
          <p style={{ fontFamily:fB, fontSize:13, color:C.textSub, margin:0 }}>{subheading}</p>
        )}
      </div>

      {/* Blurred content rows */}
      <div style={{ position:"relative", borderRadius:16, overflow:"hidden" }}>
        <div style={{ filter:"blur(7px)", pointerEvents:"none", userSelect:"none", padding:"12px 0 0" }}>
          {/* Morning section */}
          <div style={{ background:C.card, borderRadius:12, padding:"14px 16px", marginBottom:10 }}>
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
              <div style={{ width:28, height:28, borderRadius:"50%", background:C.accentGlow }}/>
              <div style={{ height:14, background:C.border, borderRadius:4, width:"35%" }}/>
            </div>
            {[1,2,3].map(i => (
              <div key={i} style={{ display:"flex", gap:14, alignItems:"flex-start", marginBottom:14 }}>
                <div style={{ width:28, height:28, borderRadius:"50%", background:C.accent, flexShrink:0 }}/>
                <div style={{ flex:1 }}>
                  <div style={{ height:12, background:C.border, borderRadius:4, marginBottom:7, width:"45%" }}/>
                  <div style={{ height:9, background:C.surface, borderRadius:4, marginBottom:4, width:"90%" }}/>
                  <div style={{ height:9, background:C.surface, borderRadius:4, width:"65%" }}/>
                </div>
              </div>
            ))}
          </div>
          {/* Evening section */}
          <div style={{ background:C.card, borderRadius:12, padding:"14px 16px", marginBottom:10 }}>
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
              <div style={{ width:28, height:28, borderRadius:"50%", background:"rgba(176,102,255,0.3)" }}/>
              <div style={{ height:14, background:C.border, borderRadius:4, width:"32%" }}/>
            </div>
            {[1,2].map(i => (
              <div key={i} style={{ display:"flex", gap:14, alignItems:"flex-start", marginBottom:14 }}>
                <div style={{ width:28, height:28, borderRadius:"50%", background:"rgba(176,102,255,0.4)", flexShrink:0 }}/>
                <div style={{ flex:1 }}>
                  <div style={{ height:12, background:C.border, borderRadius:4, marginBottom:7, width:"40%" }}/>
                  <div style={{ height:9, background:C.surface, borderRadius:4, width:"85%" }}/>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Gradient fade + CTA */}
        <div style={{ position:"absolute", bottom:0, left:0, right:0, height:"100%",
          background:"linear-gradient(180deg, rgba(6,6,14,0) 0%, rgba(6,6,14,0.7) 40%, rgba(6,6,14,0.98) 100%)",
          display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"flex-end",
          padding:"0 24px 28px", textAlign:"center" }}>
          <div style={{ fontSize:26, marginBottom:8 }}>🔒</div>
          <div style={{ fontFamily:fH, fontSize:22, color:"#ffffff", marginBottom:4, fontWeight:300 }}>
            Unlock Full Access
          </div>
          <div style={{ fontFamily:fB, fontSize:13, color:C.textSub, lineHeight:1.6, marginBottom:20, maxWidth:300 }}>
            Your personalised plan, protocols, routines, and supplement stack are waiting.
          </div>
          <button onClick={onUnlock}
            style={{ background:"linear-gradient(135deg,#C8A46A,#FFD700)", border:"none",
              borderRadius:12, padding:"14px 40px", cursor:"pointer",
              fontFamily:fB, fontSize:15, fontWeight:700, color:"#06060e",
              boxShadow:"0 4px 24px rgba(200,164,106,0.4)", letterSpacing:"0.03em", marginBottom:8 }}>
            ⚡ Unlock Premium
          </button>
          <div style={{ fontFamily:fM, fontSize:9, color:C.textDim, letterSpacing:"0.1em" }}>
            ONE-TIME PAYMENT · LIFETIME ACCESS
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Jules Horn Featured Techniques ───────────────────────────────────────
// ── Anatomical term dictionary — term → plain English tooltip ────────────
const ANATOMY_DICT = {
  // Muscles
  "zygomaticus major":            "cheek-lifting smile muscle",
  "zygomaticus minor":            "upper-lip elevator muscle",
  "zygomaticus":                  "cheekbone muscle",
  "masseter":                     "main jaw-clenching muscle",
  "temporalis":                   "temple-area chewing muscle",
  "pterygoid":                    "inner jaw-hinge muscle",
  "lateral pterygoid":            "jaw side-movement muscle",
  "medial pterygoid":             "inner jaw-closing muscle",
  "sternocleidomastoid":          "neck rotation muscle (SCM)",
  "SCM":                          "neck rotation muscle (sternocleidomastoid)",
  "orbicularis oculi":            "circular eye-closing muscle",
  "orbicularis oris":             "circular lip muscle",
  "buccinator":                   "inner cheek muscle",
  "mentalis":                     "chin-wrinkling muscle",
  "depressor anguli oris":        "mouth-corner pull-down muscle",
  "levator labii superioris":     "upper-lip-lifting muscle",
  "frontalis":                    "forehead-raising muscle",
  "corrugator supercilii":        "brow-furrowing muscle",
  "procerus":                     "nose bridge-wrinkling muscle",
  "longus colli":                 "deep neck-stabilising muscle",
  "longus capitis":               "deep head-flexing neck muscle",
  "suboccipitals":                "base-of-skull tiny muscles",
  "suboccipital":                 "base-of-skull muscle area",
  "digastric":                    "under-chin opening muscle",
  "hyoid":                        "floating throat bone",
  "platysma":                     "flat neck skin muscle",
  "risorius":                     "corner-of-mouth pulling muscle",
  "trapezius":                    "large upper back and neck muscle",
  "levator scapulae":             "neck-to-shoulder-blade lifting muscle",
  "scalene":                      "side-of-neck breathing muscle",
  "scalenes":                     "side-of-neck breathing muscles",
  "rectus capitis posterior":     "tiny back-of-skull stabiliser muscle",
  "obliquus capitis":             "skull rotation muscle at base of head",
  "malar fat pad":                "cheek fat cushion that gives fullness",
  "periorbital":                  "around the eye socket",
  "orbicularis":                  "circular ring muscle",
  "hyoid chain":                  "linked muscles from jaw to breastbone",
  "pterygomandibular":            "inner jaw ligament area",
  // Directions & positions (commonly unhighlighted)
  "posteriorly":                  "toward the back / behind",
  "anteriorly":                   "toward the front",
  "laterally":                    "toward the side / outward",
  "medially":                     "toward the middle / inward",
  "inferiorly":                   "downward / below",
  "superiorly":                   "upward / above",
  "bilaterally":                  "on both sides equally",
  "unilaterally":                 "on one side only",
  "ipsilateral":                  "same side",
  "contralateral":                "opposite side",
  "posterior":                    "back-facing / behind",
  "anterior":                     "front-facing / in front",
  "superior":                     "upper / above",
  "inferior":                     "lower / below",
  "lateral":                      "side / outward",
  "medial":                       "middle / inward",
  "bilateral":                    "both sides",
  "unilateral":                   "one side only",
  "sagittal":                     "front-to-back dividing plane",
  "coronal":                      "side-to-side dividing plane",
  "axial":                        "horizontal cross-section plane",
  "prone":                        "lying face-down",
  "supine":                       "lying face-up",
  "neutral spine":                "spine in its natural curved position",
  "neutral position":             "natural resting alignment",
  // Cervical & spinal
  "deep cervical flexors":        "deep front-of-neck stabilising muscles",
  "deep cervical flexor":         "deep front-of-neck stabilising muscle",
  "cervical flexors":             "front-of-neck bending muscles",
  "cervical spine":               "neck section of the backbone (7 bones)",
  "cervical":                     "relating to the neck vertebrae",
  "thoracic spine":               "mid-back section of backbone",
  "thoracic":                     "relating to the mid-back / chest area",
  "lumbar":                       "lower back section of backbone",
  "sacrum":                       "triangular bone at base of spine",
  "atlanto-occipital junction":   "where skull meets top of spine (C0-C1)",
  "atlanto-axial":                "joint between top two neck vertebrae",
  "atlanto-occipital":            "skull-to-top-of-spine joint",
  "C0":                           "base of skull (occiput)",
  "C1":                           "top vertebra (atlas)",
  "C2":                           "second vertebra (axis)",
  "C1-C2":                        "top two vertebrae of the neck",
  "C3":                           "third neck vertebra",
  "C4":                           "fourth neck vertebra",
  "C5":                           "fifth neck vertebra",
  "C6":                           "sixth neck vertebra",
  "C7":                           "seventh (lowest) neck vertebra",
  "T1":                           "first thoracic (mid-back) vertebra",
  "intervertebral":               "between the vertebrae",
  "vertebrae":                    "individual backbone bones",
  "vertebra":                     "single backbone bone",
  "intervertebral disc":          "cushioning pad between spine bones",
  "foramen magnum":               "hole at skull base where spine enters",
  "spinal cord":                  "main nerve highway inside the backbone",
  "anterior head translation":    "forward head posture / head too far forward",
  "forward head posture":         "head carried too far in front of shoulders",
  "hyoid chain":                  "muscles linking jaw to collarbone",
  "SNAG":                         "sustained natural apophyseal glide — a gentle spinal mobilisation technique",
  // Bones & landmarks
  "maxilla":                      "upper jaw bone",
  "mandible":                     "lower jaw bone",
  "zygomatic arch":               "cheekbone arch",
  "zygomatic":                    "cheekbone",
  "zygomaticomaxillary suture":   "seam between cheekbone and upper jaw",
  "sphenoid":                     "butterfly-shaped central skull bone",
  "vomer":                        "nasal septum bone",
  "ethmoid":                      "sinus bone behind nose bridge",
  "occipital":                    "back-of-skull bone",
  "occiput":                      "base of skull / back of head",
  "palatine":                     "roof-of-mouth bone",
  "maxillary suture":             "upper jaw growth seam",
  "hard palate":                  "roof of mouth (bony part)",
  "soft palate":                  "roof of mouth (soft back part)",
  "nasal conchae":                "scroll-shaped inner nose bones",
  "nasal bridge":                 "bony top part of the nose",
  "nasion":                       "bridge of nose between the eyes",
  "glabella":                     "smooth area between the eyebrows",
  "infraorbital rim":             "bony ridge just below eye socket",
  "orbital rim":                  "bone ring surrounding eye socket",
  "orbital bone":                 "eye socket bone",
  "supraorbital":                 "bony ridge above eye socket",
  "temporal bone":                "skull bone around the ear",
  "mastoid":                      "bony bump behind the ear",
  "gonial angle":                 "back corner of the lower jaw",
  "gonion":                       "back corner point of the lower jaw",
  "condyle":                      "rounded end of the jaw bone",
  "condylar":                     "relating to the jaw's rounded joint end",
  "malar":                        "relating to the cheekbone area",
  "malar complex":                "cheekbone and surrounding structure",
  "palatine suture":              "midline seam in the roof of mouth",
  "coronal suture":               "seam across top of skull (ear to ear)",
  "sagittal suture":              "midline seam along top of skull",
  "periosteal":                   "relating to the membrane covering bone",
  "periosteum":                   "thin membrane wrapped around bone",
  "frontal bone":                 "forehead bone",
  "parietal bone":                "side and top skull bone",
  "cranium":                      "the bony skull",
  "cranial base":                 "bottom of the skull where it meets the spine",
  "cranial":                      "relating to the skull",
  "calvaria":                     "the top dome of the skull",
  "clavicle":                     "collarbone",
  "scapula":                      "shoulder blade",
  "sternum":                      "breastbone",
  "thorax":                       "chest / ribcage region",
  "acromion":                     "bony tip of the shoulder",
  "humerus":                      "upper arm bone",
  // Fascia, connective tissue & systems
  "fascia":                       "body-wide connective tissue web",
  "fascial":                      "relating to the connective tissue web",
  "fascial adhesion":             "sticky spot where connective tissue is stuck",
  "fascial line":                 "chain of connected connective tissue",
  "dura mater":                   "tough protective brain/spine wrapping",
  "craniosacral":                 "skull-to-tailbone fluid rhythm system",
  "sphenobasilar":                "joint between sphenoid and skull base",
  "TMJ":                          "jaw hinge joint (temporomandibular joint)",
  "temporomandibular joint":      "jaw hinge joint",
  "temporomandibular":            "jaw hinge (temporal bone + mandible)",
  "lymphatic":                    "fluid-drainage immune network",
  "lymph":                        "clear fluid carrying waste from tissues",
  "lymph node":                   "filter station in the lymph network",
  "lymph nodes":                  "filter stations in the lymph network",
  "lymphatic drainage":           "moving waste fluid out of tissues",
  "glymphatic":                   "brain's own waste-drainage system",
  "vagus nerve":                  "main calming nerve (brain to gut)",
  "vagal":                        "relating to the main calming nerve",
  "vagal tone":                   "how active your calming nerve is",
  "brainstem":                    "brain's control centre for basics",
  "cerebrospinal fluid":          "protective fluid around brain and spine",
  "CSF":                          "brain/spine protective fluid",
  "intraoral":                    "inside the mouth",
  "extraoral":                    "outside the mouth",
  "periorbital fascia":           "connective tissue web around the eye socket",
  "thoracic duct":                "main lymph drainage vessel in the chest",
  "vasoconstriction":             "blood vessels narrowing / tightening",
  "vasodilation":                 "blood vessels widening / opening up",
  "intraoral pressure":           "pressure inside the mouth",
  "intra-thoracic pressure":      "pressure inside the chest cavity",
  "parasympathetic":              "rest-and-digest calming nervous system",
  "sympathetic":                  "fight-or-flight stress nervous system",
  "proprioception":               "body's sense of its own position",
  "proprioceptive":               "relating to body position sensing",
  "neuromuscular":                "nerve-to-muscle communication",
  "motor cortex":                 "brain region controlling muscle movement",
  "afferent":                     "signals travelling toward the brain",
  "efferent":                     "signals travelling away from the brain",
  "isometric":                    "muscle working without changing length",
  "isotonic":                     "muscle working while changing length",
  "eccentric":                    "muscle lengthening under load",
  "concentric":                   "muscle shortening under load",
  "hypertrophy":                  "muscle growing larger from training",
  "hypotrophic":                  "underdeveloped / smaller than normal",
  "atrophy":                      "muscle shrinking from disuse",
  "decubitus":                    "lying down position",
  "lateral decubitus":            "lying on your side",
  "effleurage":                   "light gliding massage stroke",
  "mobilisation":                 "gentle movement to restore joint range",
  "traction":                     "gentle pulling force to decompress a joint",
  "decompression":                "relieving pressure on a joint or tissue",
  "occlusion":                    "how upper and lower teeth meet",
  "bruxism":                      "teeth grinding or jaw clenching",
  "dysregulation":                "system not functioning in its normal range",
  "hypertonicity":                "muscle being too tight or overactive",
  "hypotonicity":                 "muscle being too loose or underactive",
  "remodelling":                  "bone or tissue reshaping over time",
  "suture":                       "fibrous joint between skull bones",
  "sinuses":                      "air-filled cavities in the skull bones",
  "maxillary sinus":              "air cavity inside the upper jaw bone",
  "ethmoid sinus":                "air cavities in the nose bridge bone",
  "sinus congestion":             "blocked fluid in skull air cavities",
  "collagen":                     "structural protein giving skin firmness",
  "elastin":                      "protein giving skin its stretch",
  "sebaceous":                    "oil-producing (skin gland)",
  "sebum":                        "natural skin oil",
  "keratin":                      "tough protective skin/hair/nail protein",
  "melanin":                      "pigment giving skin and hair their colour",
  "dermis":                       "deep layer of skin below the surface",
  "epidermis":                    "outer surface layer of skin",
  "subcutaneous":                 "under the skin",
  "subdermal":                    "below the skin layer",
  "DHT":                          "dihydrotestosterone — hormone linked to hair loss",
  "dihydrotestosterone":          "hormone that shrinks hair follicles",
};

// Renders text with anatomical terms highlighted as tappable chips
function AnatomicalText({ text, style }) {
  const [tooltip, setTooltip] = useState(null); // { term, meaning, idx }

  if (!text) return null;

  // Build regex from all keys (longest first to avoid partial matches)
  const terms = Object.keys(ANATOMY_DICT).sort((a, b) => b.length - a.length);
  const escaped = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`(${escaped.join('|')})`, 'gi');

  const parts = [];
  let last = 0;
  let m;
  let idx = 0;
  const re = new RegExp(regex.source, 'gi');
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ type: 'text', content: text.slice(last, m.index) });
    parts.push({ type: 'term', content: m[0], key: m[0].toLowerCase(), idx: idx++ });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ type: 'text', content: text.slice(last) });

  return (
    <span style={style}>
      {parts.map((p, i) => {
        if (p.type === 'text') return <span key={i}>{p.content}</span>;
        const meaning = ANATOMY_DICT[p.key] || ANATOMY_DICT[p.content.toLowerCase()];
        const isOpen = tooltip?.idx === p.idx;
        return (
          <span key={i} style={{ position: 'relative', display: 'inline' }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setTooltip(isOpen ? null : { term: p.content, meaning, idx: p.idx });
              }}
              style={{
                fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 700,
                color: isOpen ? '#06060e' : '#7FBAFF',
                background: isOpen ? '#7FBAFF' : 'rgba(127,186,255,0.13)',
                border: `1px solid ${isOpen ? '#7FBAFF' : 'rgba(127,186,255,0.35)'}`,
                borderRadius: 4, padding: '0px 4px', cursor: 'pointer',
                textDecoration: 'none', display: 'inline', lineHeight: 'inherit',
                transition: 'all .15s',
              }}
            >{p.content}</button>
            {isOpen && (
              <span style={{
                position: 'absolute', bottom: '120%', left: '50%',
                transform: 'translateX(-50%)',
                background: '#1a1f35', border: '1px solid #7FBAFF55',
                borderRadius: 8, padding: '6px 10px',
                fontFamily: fB, fontSize: 11, color: '#ede5d8',
                whiteSpace: 'nowrap', zIndex: 999,
                boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
                pointerEvents: 'none',
              }}>
                <span style={{ color: '#7FBAFF', fontWeight: 700 }}>{p.content}</span>
                <span style={{ color: '#9890a8' }}> = </span>
                {meaning}
                <span style={{
                  position: 'absolute', top: '100%', left: '50%',
                  transform: 'translateX(-50%)',
                  borderLeft: '5px solid transparent', borderRight: '5px solid transparent',
                  borderTop: '5px solid #7FBAFF55', display: 'block', width: 0, height: 0,
                }}/>
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}

// ── Jules Horn Featured Techniques ───────────────────────────────────────

// ── Technique streak unlock system ───────────────────────────────────────
// Techniques unlock permanently at streak milestones (survive streak resets)
const UNLOCK_KEY = "biomax_technique_unlocks"; // stored as JSON array of ids

// Which techniques unlock at each milestone
const TECHNIQUE_UNLOCK_GATES = {
  3:  ["facelift", "craniosacral"],   // day 3 streak
  7:  ["fish-mouth", "silent-scream"], // day 7 streak
  14: ["under-eye", "twisted-fascia"], // day 14 streak
};

function getUnlockedTechniques() {
  try {
    const raw = localStorage.getItem(UNLOCK_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function recordTechniqueUnlocks(streak) {
  try {
    const current = getUnlockedTechniques();
    const toAdd = [];
    Object.entries(TECHNIQUE_UNLOCK_GATES).forEach(([days, ids]) => {
      if (streak >= parseInt(days)) {
        ids.forEach(id => { if (!current.includes(id)) toAdd.push(id); });
      }
    });
    if (toAdd.length) {
      const updated = [...new Set([...current, ...toAdd])];
      localStorage.setItem(UNLOCK_KEY, JSON.stringify(updated));
    }
  } catch {}
}

function isTechniqueUnlocked(id) {
  return getUnlockedTechniques().includes(id);
}

// Which milestone unlocks this technique (for lock overlay label)
function getTechniqueGate(id) {
  for (const [days, ids] of Object.entries(TECHNIQUE_UNLOCK_GATES)) {
    if (ids.includes(id)) return parseInt(days);
  }
  return null;
}

const JULES_TECHNIQUES = [
  {
    id: "facelift",
    icon: "🌀",
    title: "Mandibular Rotation & Orbital Decompression",
    credit: "Mindful Movement",
    category: "Manual",
    laymanTitle: "Jaw Spin + Eye Socket Press",
    summary: "Releases facial inflammation by rotating the jawline, pressing back on the orbital rim, and using breath cycles to flush lymphatic fluid from the face.",
    startPosition: "Sit upright in a chair or cross-legged on the floor. Spine tall, shoulders dropped and relaxed away from ears.",
    steps: [
      "Place your fingertips on your jawline at the back corners — just in front of your ears at the TMJ hinge.",
      "Apply gentle firm pressure and slowly rotate your masseter muscle in small circles, working along the mandible toward your chin.",
      "With two fingers, gently press back against the outer corner of your eye socket along the orbital rim — do NOT touch the eye itself.",
      "Maintain this contact and take a slow deep breath in through your nose for 4 counts.",
      "Hold 2 counts, then exhale slowly through your mouth for 6 counts, maintaining the pressure throughout.",
      "Repeat the breath cycle 4–6 times. Release, then repeat on the other side.",
    ],
    why: "Rotational pressure along the mandible + orbital rim disrupts fascial adhesions trapping lymphatic fluid in the face. The breath cycle creates pressure changes that drive lymph back toward the thoracic duct — visibly reducing puffiness and inflammation.",
    sets: "1× daily · 3–5 min",
    timeframe: "Visible results within days",
  },
  {
    id: "craniosacral",
    icon: "💆",
    title: "Sphenoid Traction: Palate & Nasal Bridge Release",
    credit: "Mindful Movement",
    category: "Manual",
    laymanTitle: "Thumb on Roof of Mouth + Bridge Press",
    summary: "Decompresses central skull compression by simultaneously lifting the hard palate from inside and pressing down on the nasal bridge while breathing in.",
    startPosition: "Lie on your back on a flat firm surface — yoga mat or floor. Head flat, no pillow. Arms relaxed at your sides.",
    steps: [
      "Wash your hands thoroughly. Use a clean glove on the intraoral hand if preferred.",
      "Insert your thumb into your mouth and press gently upward against the hard palate — centre of the roof, toward the soft palate.",
      "With your other hand, use two fingertips to press gently downward on the bridge of your nose, just below the brow bone where the ethmoid meets the frontal bone.",
      "Hold both contact points simultaneously. Inhale very slowly through your nose for 5–6 counts.",
      "As you breathe in, slightly increase upward palate pressure and downward nasal bridge pressure.",
      "Exhale slowly through the nose. Hold both contacts throughout. Repeat 4–6 breath cycles.",
      "Release gently and rest 30 seconds before rising.",
    ],
    why: "The hard palate and vomer connect directly to the sphenoid — the keystone of the skull. Simultaneous intraoral lift + nasal bridge decompression creates traction that releases craniosacral compression, reducing asymmetry and mid-face flatness.",
    sets: "1× daily · 4–6 min",
    timeframe: "2–4 weeks for structural shift",
  },
  {
    id: "fish-mouth",
    icon: "🐟",
    title: "Buccinator & TMJ Counter-Rotation",
    credit: "Mindful Movement",
    category: "Manual",
    laymanTitle: "Cheek Finger Circles for Jaw Reset",
    summary: "A 1-minute counter-clockwise cheek rotation that releases deep jaw, TMJ, and zygomatic arch tension while regulating the vagus nerve.",
    startPosition: "Sit upright or stand facing a mirror. Spine tall. Use one hand to gently support the opposite side of your head.",
    steps: [
      "Press two fingertips firmly into your cheek, just in front of your masseter — in the buccinator muscle belly.",
      "Apply a gentle counter-clockwise rotation with your fingertips, maintaining steady contact with the cheek.",
      "Use the opposite hand to support the side of your head just above the ear.",
      "Close the eye on the same side as the fingers. Look slightly upward and outward with the open eye.",
      "Breathe slowly: inhale through the nose for 4 counts, exhale through the mouth for 6 counts.",
      "Repeat 6 slow breath rounds on each side.",
    ],
    why: "The buccinator and masseter connect through deep facial fascia to the TMJ, which links directly to the brainstem. Counter-clockwise rotation + breath unlocks the temporomandibular joint, decompresses the zygomatic arch, and activates vagal tone — calming stress response and reducing facial puffiness.",
    sets: "1–2× daily · 2–3 min",
    timeframe: "Immediate tension relief; structural change 2–3 weeks",
  },
  {
    id: "silent-scream",
    icon: "😮",
    title: "Hyoid Chain Isometric Decompression",
    credit: "Mindful Movement",
    category: "Manual",
    laymanTitle: "Fist Under Chin Wide Open Mouth Hold",
    summary: "Resistance-based jaw opening using a fist held under the chin — trains neck and jaw muscles while releasing deep fascia and stored tension around the mandible.",
    startPosition: "Sit upright in a chair, feet flat on the floor. Spine tall. Make a fist with one hand and place it under your chin.",
    steps: [
      "Make a fist and press it firmly upward against the bottom of your chin (the mentalis / digastric region).",
      "Push your jaw DOWN and open your mouth as wide as possible, resisting your own fist — create isometric tension.",
      "Open your mouth fully into a wide 'silent scream' shape. Hold for 5 seconds.",
      "Inhale slowly through your nose, then exhale through your mouth while holding the position.",
      "You should feel the back of your skull (occiput area) and suboccipitals activate and fire.",
      "Hold 15–20 seconds total. Rest 10 seconds, then repeat 2–3 rounds.",
    ],
    why: "Isometric resistance at the mandible engages the full hyoid chain — from the digastric and platysma up to the suboccipitals at the base of skull. This chain release decompresses the cervical spine, reduces forward head posture, and releases deeply held jaw tension connected to the brainstem.",
    sets: "2–3 rounds · 15–20 sec each · 1× daily",
    timeframe: "Immediate decompression; 2–4 weeks cumulative",
  },
  {
    id: "under-eye",
    icon: "👁️",
    title: "Infraorbital Rim Periosteal Reset",
    credit: "Mindful Movement",
    category: "Manual",
    laymanTitle: "Under-Eye Bone Micro-Circles",
    summary: "Micro-rotations on the infraorbital rim beneath the eye to reset limbic-facial tension, drain sub-orbital puffiness, and lift the mid-face.",
    startPosition: "Sit upright or lie down. Support the back of your head with the opposite hand. Relax your jaw and shoulders completely.",
    steps: [
      "Place 2 fingertips just under one eye, directly along the infraorbital rim — the bony ridge below the eye socket. Do NOT press on the eye itself.",
      "Use the opposite hand to gently support the back of your head.",
      "Apply light upward pressure into the orbital rim bone — you're not massaging soft tissue, you're contacting bone.",
      "Perform very gentle counter-clockwise micro-rotations while maintaining upward pressure.",
      "Gaze softly upward and outward with that eye — this engages the orbicularis oculi and lifts orbital fascia.",
      "Breathe: inhale through the nose for 4, exhale through the mouth for 6. Repeat for 6 full breaths.",
      "Release, rest 10 seconds, then switch sides.",
    ],
    why: "The infraorbital rim sits directly below the orbicularis oculi and above the maxillary sinus. Upward pressure + micro-rotation decompresses the maxillary suture, drains sub-orbital lymphatic pooling, and resets limbic tension patterns stored in periorbital fascia — lifting the under-eye and reducing hollows.",
    sets: "1× daily · 3–4 min",
    timeframe: "Puffiness reduces in days; structural lift in 3–6 weeks",
  },
  {
    id: "twisted-fascia",
    icon: "🌪️",
    title: "Spiral Fascial Line Unwind",
    credit: "Mindful Movement",
    category: "Manual",
    laymanTitle: "Cross-Arms Spinal Spiral Twist",
    summary: "A full-body spiral twist with crossed arms and controlled breathing that unwinds fascia chains, resets the vagus nerve, and releases stored trauma from the body.",
    startPosition: "Stand with feet shoulder-width apart, flat on the ground. Cross your arms over your chest — right arm over left.",
    steps: [
      "Plant both feet firmly on the ground, toes forward. Cross your arms over your chest (right over left).",
      "Slowly rotate your upper torso to the left while keeping your hips and feet facing forward — create a full spinal twist.",
      "Once you reach your comfortable rotation limit, stop and hold the twist.",
      "Take a deep, slow breath in through the nose for 4–5 counts — feel the ribcage expand against the twist.",
      "Hold the breath 2 counts, then exhale slowly through the mouth for 6 counts.",
      "Repeat 4–6 breath cycles in this twisted position. Then slowly unwind and switch to the opposite direction.",
      "Do not be surprised if you yawn, feel warmth in your chest, or feel emotion rise — this is fascia releasing.",
    ],
    why: "Crossing the arms and rotating the spine engages the body's spiral fascial lines — the same lines that store chronic tension, postural imbalance, and trauma patterns. The combined mechanical twist + breath activates the vagus nerve through ribcage compression, reintegrates left/right brain coordination, and unwinds fascial adhesions from the thorax to the jaw.",
    sets: "2× daily · 2–3 min per side",
    timeframe: "Nervous system reset immediate; postural change 4–6 weeks",
  },
];

function FeaturedTechniques() {
  const [openId, setOpenId] = useState(null);
  const [unlocked, setUnlocked] = useState(() => getUnlockedTechniques());
  const col = "#E8C87A";
  const streak = getStreak();

  // Sync unlocks whenever streak changes
  useEffect(() => {
    recordTechniqueUnlocks(streak);
    setUnlocked(getUnlockedTechniques());
  }, [streak]);

  return (
    <div>
      {JULES_TECHNIQUES.map(t => {
        const isUnlocked = unlocked.includes(t.id);
        const gate = getTechniqueGate(t.id);
        const isOpen = openId === t.id && isUnlocked;
        const daysLeft = gate ? Math.max(0, gate - streak) : 0;
        return (
          <div key={t.id} style={{
            background: isUnlocked ? C.surface : "rgba(255,255,255,0.02)",
            border:`1px solid ${isOpen ? col+"66" : isUnlocked ? C.border : "rgba(255,255,255,0.06)"}`,
            borderRadius:12, marginBottom:10, overflow:"hidden", transition:"all .3s",
            boxShadow: isOpen ? `0 0 20px ${col}22` : "none",
            opacity: isUnlocked ? 1 : 0.7 }}>
            <button onClick={() => isUnlocked && setOpenId(isOpen ? null : t.id)}
              style={{ width:"100%", background:"none", border:"none", padding:"14px 16px",
                cursor: isUnlocked ? "pointer" : "default",
                display:"flex", alignItems:"center", gap:12, textAlign:"left" }}>
              <div style={{ width:32, height:32, borderRadius:8,
                background: isUnlocked ? "rgba(232,200,122,0.15)" : "rgba(255,255,255,0.04)",
                border:`1px solid ${isUnlocked ? "rgba(232,200,122,0.3)" : "rgba(255,255,255,0.08)"}`,
                display:"flex", alignItems:"center", justifyContent:"center",
                fontSize:20, flexShrink:0, filter: isUnlocked ? "none" : "grayscale(1)" }}>{t.icon}</div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:"flex", gap:6, alignItems:"center", marginBottom:3, flexWrap:"wrap" }}>
                  <span style={{ fontFamily:fB, fontSize:13, fontWeight:700,
                    color: isUnlocked ? C.text : C.textDim }}>{t.title}</span>
                  {t.credit && <span style={{ fontFamily:fM, fontSize:9, color: isUnlocked ? "#E8C87A" : C.textDim,
                    border:`1px solid ${isUnlocked ? "rgba(232,200,122,0.3)" : "rgba(255,255,255,0.1)"}`,
                    borderRadius:4, padding:"1px 6px" }}>{t.credit}</span>}
                  {!isUnlocked && (
                    <span style={{ fontFamily:fM, fontSize:9, color:"#FF6E6E",
                      border:"1px solid rgba(255,110,110,0.3)", borderRadius:4, padding:"1px 6px" }}>
                      🔒 {daysLeft}d streak
                    </span>
                  )}
                </div>
                <span style={{ fontFamily:fB, fontSize:11, color:C.textDim }}>
                  Plain English: <span style={{ color:"#7FBAFF" }}>{t.laymanTitle}</span>
                </span>
              </div>
              <span style={{ color:"#E8C87A", fontSize:16, transform:isOpen?"rotate(90deg)":"none", transition:"transform .2s", flexShrink:0 }}>›</span>
            </button>
            {!isUnlocked && (
              <div style={{ padding:"0 16px 14px" }}>
                <div style={{ height:1, background:"rgba(255,255,255,0.05)", marginBottom:12 }}/>
                <div style={{ background:"rgba(255,110,110,0.06)", border:"1px solid rgba(255,110,110,0.15)",
                  borderRadius:8, padding:"12px 14px", display:"flex", gap:12, alignItems:"center" }}>
                  <div style={{ fontSize:24, flexShrink:0 }}>🔒</div>
                  <div>
                    <div style={{ fontFamily:fB, fontSize:12, fontWeight:700, color:"#FF9E9E", marginBottom:3 }}>
                      Unlocks at {gate}-day streak
                    </div>
                    <div style={{ fontFamily:fB, fontSize:11, color:C.textDim, lineHeight:1.5 }}>
                      {daysLeft > 0
                        ? `${daysLeft} more day${daysLeft !== 1 ? "s" : ""} to go — keep your streak alive`
                        : "Complete today's exercises to claim this technique"}
                    </div>
                  </div>
                </div>
              </div>
            )}
            {isOpen && (
              <div style={{ padding:"0 16px 18px" }}>
                <div style={{ height:1, background:C.border, marginBottom:14 }}/>
                <div style={{ fontFamily:fB, fontSize:12, lineHeight:1.65, marginBottom:12 }}>
                  <AnatomicalText text={t.summary} style={{ color:C.textSub }} />
                </div>
                <div style={{ background:"rgba(127,186,255,0.08)", border:"1px solid rgba(127,186,255,0.2)",
                  borderRadius:8, padding:"10px 14px", marginBottom:14, display:"flex", gap:10, alignItems:"flex-start" }}>
                  <span style={{ fontSize:16, flexShrink:0 }}>📍</span>
                  <div>
                    <div style={{ fontFamily:fM, fontSize:9, color:"#7FBAFF", letterSpacing:"0.1em", marginBottom:3 }}>STARTING POSITION</div>
                    <div style={{ fontFamily:fB, fontSize:12, color:C.text, lineHeight:1.55 }}>{t.startPosition}</div>
                  </div>
                </div>
                <div style={{ fontFamily:fM, fontSize:9, color:C.textDim, letterSpacing:"0.12em", marginBottom:10 }}>STEP-BY-STEP</div>
                {t.steps.map((s, i) => (
                  <div key={i} style={{ display:"flex", gap:12, marginBottom:10, alignItems:"flex-start" }}>
                    <div style={{ width:24, height:24, borderRadius:"50%", background:"rgba(232,200,122,0.2)",
                      border:"1px solid rgba(232,200,122,0.4)", display:"flex", alignItems:"center", justifyContent:"center",
                      fontFamily:fM, fontSize:10, color:"#E8C87A", flexShrink:0, fontWeight:700 }}>{i+1}</div>
                    <div style={{ fontFamily:fB, fontSize:12, lineHeight:1.65, flex:1 }}>
                      <AnatomicalText text={s} style={{ color:C.text }} />
                    </div>
                  </div>
                ))}
                <div style={{ background:C.accentGlow, borderRadius:8, padding:"10px 14px", marginTop:4 }}>
                  <div style={{ fontFamily:fM, fontSize:9, color:C.accent, letterSpacing:"0.1em", marginBottom:4 }}>WHY THIS WORKS</div>
                  <div style={{ fontFamily:fB, fontSize:12, lineHeight:1.6, fontStyle:"italic" }}>
                    <AnatomicalText text={t.why} style={{ color:C.accentBright }} />
                  </div>
                </div>
                <div style={{ display:"flex", gap:8, marginTop:12, flexWrap:"wrap" }}>
                  <div style={{ background:C.surface, borderRadius:8, padding:"8px 12px" }}>
                    <div style={{ fontFamily:fM, fontSize:9, color:C.textDim, marginBottom:2 }}>FREQUENCY</div>
                    <div style={{ fontFamily:fB, fontSize:12, color:"#E8C87A" }}>{t.sets}</div>
                  </div>
                  <div style={{ background:C.surface, borderRadius:8, padding:"8px 12px" }}>
                    <div style={{ fontFamily:fM, fontSize:9, color:C.textDim, marginBottom:2 }}>RESULTS</div>
                    <div style={{ fontFamily:fB, fontSize:12, color:C.gold }}>{t.timeframe}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function LoadingTip() {
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const cycle = () => {
      setVisible(false);
      setTimeout(() => {
        setIdx(i => (i + 1) % LOADING_TIPS.length);
        setVisible(true);
      }, 400);
    };
    const id = setInterval(cycle, 8000);
    return () => clearInterval(id);
  }, []);

  const tip = LOADING_TIPS[idx];
  return (
    <div style={{
      transition:"opacity 0.4s ease",
      opacity: visible ? 1 : 0,
      background:"rgba(200,164,106,0.06)",
      border:`1px solid rgba(200,164,106,0.18)`,
      borderRadius:10,
      padding:"12px 16px",
      textAlign:"left",
      marginBottom:24,
    }}>
      <div style={{ fontFamily:fM, fontSize:9, color:C.accentDim, letterSpacing:"0.14em", marginBottom:5 }}>
        WHILE YOU WAIT — DAILY HABIT
      </div>
      <div style={{ fontFamily:fB, fontSize:12, color:"#FF9090", marginBottom:5 }}>{tip.label}</div>
      <div style={{ fontFamily:fB, fontSize:12, color:C.textSub, lineHeight:1.6 }}>✓ {tip.tip}</div>
      <div style={{ display:"flex", gap:4, marginTop:10 }}>
        {LOADING_TIPS.map((_,i) => (
          <div key={i} style={{
            width: i === idx ? 16 : 4, height:3, borderRadius:2,
            background: i === idx ? C.accent : C.border,
            transition:"all 0.4s ease",
          }}/>
        ))}
      </div>
    </div>
  );
}

function BiohackRing({ progress, size = 240 }) {
  const [tick, setTick] = useState(0);
  const [decodedLabel, setDecodedLabel] = useState("INIT");
  const [displayProgress, setDisplayProgress] = useState(0);
  const displayRef = useRef(0);
  const glyphs = "ABCDEF0123456789αβγδεζηθ∑∆∇∞≡≈∫∂←→↑↓◈◉⬡⬢⬣◊▲▼◀▶";

  // Animate display progress without stale closure bug
  useEffect(() => {
    const target = progress;
    const startVal = displayRef.current;
    const duration = 600;
    const startTime = Date.now();
    let raf;
    const animate = () => {
      const t = Math.min((Date.now() - startTime) / duration, 1);
      const val = Math.round(startVal + (target - startVal) * t);
      displayRef.current = val;
      setDisplayProgress(val);
      if (t < 1) raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [progress]);

  // Ticker for glyph animation — slower interval to avoid thrashing
  useEffect(() => {
    const id = setInterval(() => setTick(n => n + 1), 150);
    return () => clearInterval(id);
  }, []);

  // Label cycling
  useEffect(() => {
    const labels = ["SCANNING", "PARSING", "MAPPING", "DECODING", "ANALYZING", "SYNCING", "COMPILING"];
    let i = 0;
    const id = setInterval(() => { setDecodedLabel(labels[i++ % labels.length]); }, 900);
    return () => clearInterval(id);
  }, []);

  // Generate chars deterministically from tick so no state array needed
  const chars = Array.from({ length: 8 }, (_, i) => ({
    char: glyphs[(tick * 7 + i * 13) % glyphs.length],
    opacity: 0.2 + (((tick + i * 3) % 5) / 5) * 0.7,
  }));

  const r = size / 2 - 20;
  const circ = 2 * Math.PI * r;
  const dashOffset = circ - (displayProgress / 100) * circ;
  const r2 = size / 2 - 36;
  const circ2 = 2 * Math.PI * r2;

  // Orbital tick marks
  const ticks = Array.from({ length: 60 }, (_, i) => {
    const angle = (i / 60) * 2 * Math.PI - Math.PI / 2;
    const r_outer = size / 2 - 8;
    const r_inner = size / 2 - (i % 5 === 0 ? 18 : 13);
    return {
      x1: size/2 + r_inner * Math.cos(angle),
      y1: size/2 + r_inner * Math.sin(angle),
      x2: size/2 + r_outer * Math.cos(angle),
      y2: size/2 + r_outer * Math.sin(angle),
      major: i % 5 === 0,
    };
  });

  return (
    <div style={{ position:"relative", width:size, height:size, margin:"0 auto" }}>
      <svg width={size} height={size} style={{ animation:"ringPulse 2s ease infinite" }}>
        {/* Outer tick ring */}
        {ticks.map((t, i) => (
          <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
            stroke={i / 60 * 100 <= displayProgress ? C.accent : "#1e2238"}
            strokeWidth={t.major ? 2 : 1} opacity={t.major ? 0.9 : 0.5}/>
        ))}
        {/* Base track */}
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#1e2238" strokeWidth={3}/>
        {/* Progress arc — matrix green */}
        <circle cx={size/2} cy={size/2} r={r} fill="none"
          stroke={C.accent} strokeWidth={3}
          strokeDasharray={circ} strokeDashoffset={dashOffset}
          strokeLinecap="butt"
          transform={`rotate(-90 ${size/2} ${size/2})`}
          style={{ transition:"stroke-dashoffset 0.4s ease", filter:`drop-shadow(0 0 8px ${C.accentGlow2})` }}/>
        {/* Inner orbital ring */}
        <circle cx={size/2} cy={size/2} r={r2} fill="none" stroke="#1e2238" strokeWidth={1} strokeDasharray="4 6"/>
        {/* Inner arc accent */}
        <circle cx={size/2} cy={size/2} r={r2} fill="none"
          stroke="#b8955a" strokeWidth={1.5}
          strokeDasharray={`${(displayProgress/100)*circ2} ${circ2}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size/2} ${size/2})`}
          style={{ transition:"stroke-dasharray 0.4s ease", opacity:0.7 }}/>
        {/* Center cross-hairs */}
        {/* Progress number */}
        <text x={size/2} y={size/2-12} textAnchor="middle" dominantBaseline="middle"
          fill={C.accentBright} fontSize={size > 180 ? 36 : 22}
          fontFamily="'Cormorant Garamond',serif" fontWeight="600"
          style={{ animation:"codeFlicker 3s ease infinite" }}>
          {displayProgress}%
        </text>
        {/* Decoding label */}
        <text x={size/2} y={size/2+14} textAnchor="middle"
          fill={C.accentDim} fontSize={9}
          fontFamily="'JetBrains Mono',monospace" letterSpacing="0.2em">
          {decodedLabel}
        </text>
        {/* Scan line */}
        <rect x={size/2-r+4} y={size/2-1} width={(r-4)*2} height={1} fill={C.accentGlow}
          style={{ animation:"scanLine 2s linear infinite" }}/>
      </svg>
      {/* Matrix rain chars around outer edge */}
      <div style={{
        position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center",
        pointerEvents:"none",
      }}>
        {chars.slice(0, 8).map((c, i) => {
          const angle = (i / 8) * 2 * Math.PI;
          const px = size/2 + (r + 22) * Math.cos(angle);
          const py = size/2 + (r + 22) * Math.sin(angle);
          return (
            <span key={i} style={{
              position:"absolute",
              left: px - 6, top: py - 7,
              fontFamily: fM, fontSize: 10,
              color: C.accent,
              opacity: c?.opacity ?? 0.3,
              animation:"matrixRain 0.8s ease infinite",
              animationDelay: `${i * 0.1}s`,
            }}>{c?.char ?? "0"}</span>
          );
        })}
      </div>
    </div>
  );
}

function Btn({ children, onClick, disabled, variant = "primary", style = {} }) {
  const [hov, setHov] = useState(false);
  const base = {
    fontFamily: fB, fontWeight: 700, fontSize: 13, letterSpacing: "0.07em",
    textTransform: "uppercase", border: "none", borderRadius: 8,
    padding: "13px 28px", cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.4 : 1, transition: "all 0.18s ease", ...style,
  };
  if (variant === "primary") return (
    <button onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      onClick={onClick} disabled={disabled}
      style={{ ...base, background: hov ? `linear-gradient(135deg,${C.accentBright},${C.gold})` : `linear-gradient(135deg,${C.accent},${C.accentBright})`,
        color: "#06060e", boxShadow: hov ? `0 0 28px ${C.accentGlow2}` : "none" }}>
      {children}
    </button>
  );
  return (
    <button onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      onClick={onClick} disabled={disabled}
      style={{ ...base, background: hov ? C.card : C.surface, color: C.textSub,
        border: `1px solid ${hov ? C.borderHot : C.border}` }}>
      {children}
    </button>
  );
}

function AnimatedRing({ score, size = 120, hero = false }) {
  const [anim, setAnim] = useState(0);
  const strokeW = hero ? 6 : 7;
  const r = (size - strokeW * 2) / 2;
  const circ = 2 * Math.PI * r;
  const color = scoreColor(score);
  useEffect(() => {
    const t0 = Date.now(), dur = 1600;
    const tick = () => {
      const t = clamp((Date.now()-t0)/dur, 0, 1);
      const ease = 1 - Math.pow(1-t, 3);
      setAnim(Math.round(score * ease));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [score]);

  if (hero) {
    // Hero score: number + label rendered entirely inside SVG to avoid any overlap
    const numFontSize = size * 0.26;
    const subFontSize = size * 0.065;
    return (
      <svg width={size} height={size} style={{ display:"block", overflow:"visible" }}>
        {/* Outer glow track */}
        <circle cx={size/2} cy={size/2} r={r+4} fill="none" stroke={color} strokeWidth={1} opacity={0.1}/>
        {/* Base track */}
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={C.border} strokeWidth={strokeW}/>
        {/* Progress arc */}
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={strokeW}
          strokeDasharray={`${(anim/100)*circ} ${circ}`} strokeLinecap="round"
          transform={`rotate(-90 ${size/2} ${size/2})`}
          style={{ filter:`drop-shadow(0 0 10px ${color}99)`, transition:"stroke-dasharray .04s" }}/>
        {/* Dot at end of arc */}
        {anim > 2 && (() => {
          const angle = ((anim/100) * 360 - 90) * Math.PI / 180;
          const dx = size/2 + r * Math.cos(angle);
          const dy = size/2 + r * Math.sin(angle);
          return <circle cx={dx} cy={dy} r={strokeW/2+1.5} fill={color} style={{ filter:`drop-shadow(0 0 6px ${color})` }}/>;
        })()}
        {/* Score number — centred, safely inside ring */}
        <text
          x={size/2} y={size/2 - subFontSize * 0.6}
          textAnchor="middle" dominantBaseline="middle"
          fill={color}
          fontSize={numFontSize}
          fontFamily={fH}
          fontWeight="600"
          letterSpacing="-1"
          style={{ filter:`drop-shadow(0 0 20px ${color}55)` }}
        >{anim}</text>
        {/* "/ 100" subtitle */}
        <text
          x={size/2} y={size/2 + numFontSize * 0.62}
          textAnchor="middle" dominantBaseline="middle"
          fill={C.textDim}
          fontSize={subFontSize}
          fontFamily={fM}
          letterSpacing="2"
        >/ 100</text>
      </svg>
    );
  }

  // Small ring (metric cards)
  return (
    <svg width={size} height={size}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={C.border} strokeWidth={strokeW}/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={strokeW}
        strokeDasharray={`${(anim/100)*circ} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`}
        style={{ transition:"stroke-dasharray .05s" }}/>
      <text x={size/2} y={size/2+1} textAnchor="middle" dominantBaseline="middle"
        fill={color} fontSize={size>100?20:15} fontFamily={fH} fontWeight="700">{anim}</text>
    </svg>
  );
}

function Bar({ label, score, note }) {
  const [w, setW] = useState(0);
  const color = scoreColor(score);
  useEffect(() => {
    const t0 = Date.now(), dur = 800 + Math.random()*400;
    const tick = () => {
      const t = clamp((Date.now()-t0)/dur, 0, 1);
      setW(score * (1-Math.pow(1-t,3)));
      if (t < 1) requestAnimationFrame(tick);
    };
    setTimeout(() => requestAnimationFrame(tick), Math.random()*200);
  }, [score]);
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
        <span style={{ fontFamily:fB, fontSize:13, color:C.text, fontWeight:600 }}>{label}</span>
        <span style={{ fontFamily:fM, fontSize:12, color, fontWeight:700 }}>{score} · {scoreLabel(score)}</span>
      </div>
      <div style={{ height:6, background:"#0e1020", borderRadius:3, overflow:"hidden", marginBottom:4, boxShadow:`inset 0 0 4px rgba(0,0,0,0.6)` }}>
        <div style={{ height:"100%", width:`${w}%`, background:`linear-gradient(90deg,${color}66,${color},${color}ee)`,
          borderRadius:3, boxShadow:`0 0 14px ${color}88, 0 0 4px ${color}`, transition:"width .05s" }}/>
      </div>
      {note && <p style={{ fontFamily:fB, fontSize:11, color:C.textSub, lineHeight:1.5 }}>{note}</p>}
    </div>
  );
}

function UploadBox({ label, sublabel, icon, hint, value, onChange, validating, valid, error }) {
  const ref = useRef();
  const [drag, setDrag] = useState(false);
  return (
    <div
      onClick={() => !value && ref.current.click()}
      onDragOver={e=>{e.preventDefault();setDrag(true)}}
      onDragLeave={()=>setDrag(false)}
      onDrop={e=>{e.preventDefault();setDrag(false);const f=e.dataTransfer.files[0];if(f)onChange(f)}}
      style={{
        background: error ? "rgba(217,79,79,0.06)" : valid ? "rgba(62,201,106,0.05)" : drag ? C.accentGlow : C.card,
        border: `2px dashed ${error ? C.red : valid ? C.green : drag ? C.accentBright : value ? C.accentDim : C.border}`,
        borderRadius: 16,
        cursor: value ? "default" : "pointer",
        height: 220,
        display: "flex", flexDirection:"column",
        position: "relative", overflow:"hidden", transition:"all 0.2s",
      }}>
      {value ? (
        <>
          <img src={value} alt={label} style={{ width:"100%", height:"100%", objectFit:"cover" }}/>
          {validating && (
            <div style={{ position:"absolute", inset:0, background:"rgba(6,8,16,0.88)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:8 }}>
              <div style={{ fontFamily:fM, fontSize:18, color:C.accent, animation:"spin 1s linear infinite", display:"inline-block" }}>◈</div>
              <div style={{ fontFamily:fM, fontSize:10, color:C.accent, letterSpacing:"0.15em" }}>VALIDATING…</div>
            </div>
          )}
          {valid && !validating && (
            <div style={{ position:"absolute", top:10, right:10, background:C.green, borderRadius:6, padding:"3px 8px", fontFamily:fM, fontSize:10, color:"#000", fontWeight:700 }}>✓ Valid</div>
          )}
          {error && !validating && (
            <div style={{ position:"absolute", inset:0, background:"rgba(6,8,16,0.88)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:8, padding:16 }}>
              <div style={{ fontSize:24 }}>⚠️</div>
              <div style={{ fontFamily:fB, fontSize:12, color:C.red, textAlign:"center", lineHeight:1.5 }}>{error}</div>
              <button onClick={e=>{e.stopPropagation();onChange(null)}}
                style={{ fontFamily:fB, fontSize:11, background:C.border, border:"none", color:C.text, borderRadius:6, padding:"6px 14px", cursor:"pointer", marginTop:4 }}>
                Try Again
              </button>
            </div>
          )}
          {!validating && !error && valid && (
            <button onClick={e=>{e.stopPropagation();onChange(null)}}
              style={{ position:"absolute", bottom:8, right:8, fontFamily:fB, fontSize:10, background:"rgba(6,8,16,0.8)", border:`1px solid ${C.border}`, color:C.textSub, borderRadius:6, padding:"4px 10px", cursor:"pointer" }}>
              Change
            </button>
          )}
        </>
      ) : (
        <>
          {/* Label block — top-left, inside card */}
          <div style={{ padding:"18px 18px 0" }}>
            <div style={{ fontSize:28, marginBottom:10 }}>{icon}</div>
            <div style={{ fontFamily:fB, fontSize:14, fontWeight:700, color:C.text, marginBottom:4 }}>{label}</div>
            {sublabel && <div style={{ fontFamily:fB, fontSize:11, color:C.textSub, lineHeight:1.5 }}>{sublabel}</div>}
          </div>
          {/* Upload cue — bottom center */}
          <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"flex-end", paddingBottom:18, gap:4 }}>
            <div style={{ fontFamily:fB, fontSize:12, color:C.textSub }}>Drop or click to upload</div>
            {hint && <div style={{ fontFamily:fM, fontSize:9, color:C.textDim, textAlign:"center", padding:"0 12px", letterSpacing:"0.06em" }}>{hint}</div>}
          </div>
        </>
      )}
      <input ref={ref} type="file" accept="image/*" style={{display:"none"}} onChange={e=>{const f=e.target.files[0];if(f)onChange(f);e.target.value="";}}/>
    </div>
  );
}

function RoutineStep({ step, index }) {
  return (
    <div style={{ display:"flex", gap:16, paddingBottom:20, position:"relative" }}>
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", minWidth:40 }}>
        <div style={{ width:32, height:32, borderRadius:"50%", background:`linear-gradient(135deg,${C.accent},${C.accentBright})`,
          display:"flex", alignItems:"center", justifyContent:"center", fontFamily:fM, fontSize:11, fontWeight:700, color:"#06060e", flexShrink:0 }}>
          {index+1}
        </div>
        <div style={{ flex:1, width:1, background:C.border, marginTop:6 }}/>
      </div>
      <div style={{ flex:1, paddingBottom:4 }}>
        <div style={{ fontFamily:fB, fontSize:14, fontWeight:700, color:C.text, marginBottom:4 }}>{step.action}</div>
        {step.position && (
          <div style={{ display:"inline-flex", alignItems:"center", gap:5, background:"rgba(127,186,255,0.08)",
            border:"1px solid rgba(127,186,255,0.2)", borderRadius:6, padding:"3px 8px", marginBottom:6 }}>
            <span style={{ fontSize:11 }}>📍</span>
            <span style={{ fontFamily:fM, fontSize:10, color:"#7FBAFF" }}>{step.position}</span>
          </div>
        )}
        <div style={{ fontFamily:fB, fontSize:12, color:C.textSub, lineHeight:1.65, marginBottom:4 }}>{step.detail}</div>
        <div style={{ fontFamily:fB, fontSize:11, color:C.accentDim, fontStyle:"italic" }}>↳ {step.why}</div>
      </div>
    </div>
  );
}

function ProtocolCard({ p }) {
  const [open, setOpen] = useState(false);
  const [showLayman, setShowLayman] = useState(false);
  const pc = { High:C.red, Medium:C.accent, Foundation:C.gold }[p.priority] || C.accent;
  return (
    <div style={{ background:C.card, border:`1px solid ${open?C.accentDim:C.border}`, borderRadius:12,
      marginBottom:10, overflow:"hidden", transition:"border-color .2s", boxShadow:open?`0 0 20px ${C.accentGlow}`:"none" }}>
      <button onClick={()=>setOpen(o=>!o)}
        style={{ width:"100%", background:"none", border:"none", padding:"12px 14px", cursor:"pointer",
          display:"flex", alignItems:"center", gap:10, textAlign:"left" }}>
        <span style={{ fontSize:20 }}>{p.icon}</span>
        <div style={{ flex:1 }}>
          <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:3, flexWrap:"wrap" }}>
            <span style={{ fontFamily:fB, fontSize:13, fontWeight:700, color:C.text }}>{p.title}</span>
            <span style={{ fontFamily:fM, fontSize:8, color:pc, border:`1px solid ${pc}44`, borderRadius:4, padding:"1px 4px", whiteSpace:"nowrap" }}>{p.priority}</span>
          </div>
          {p.laymanTitle && (
            <div style={{ fontFamily:fB, fontSize:11, color:C.textDim, marginBottom:1 }}>
              Also known as: <span style={{ color:C.accent }}>{p.laymanTitle}</span>
            </div>
          )}
          <span style={{ fontFamily:fB, fontSize:11, color:C.textSub }}>{p.category} · {p.timeframe}</span>
        </div>
        <span style={{ color:C.accent, fontSize:16, transform:open?"rotate(90deg)":"none", transition:"transform .2s" }}>›</span>
      </button>
      {open && (
        <div style={{ padding:"0 18px 18px" }}>
          <div style={{ height:1, background:C.border, marginBottom:14 }}/>
          {p.laymanTitle && (
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
              <button onClick={()=>setShowLayman(false)}
                style={{ fontFamily:fM, fontSize:10, padding:"4px 12px", borderRadius:20, border:"none", cursor:"pointer",
                  background: !showLayman ? C.accent : C.surface, color: !showLayman ? "#06060e" : C.textSub, fontWeight: !showLayman ? 700 : 400 }}>
                Anatomical
              </button>
              <button onClick={()=>setShowLayman(true)}
                style={{ fontFamily:fM, fontSize:10, padding:"4px 12px", borderRadius:20, border:"none", cursor:"pointer",
                  background: showLayman ? C.accent : C.surface, color: showLayman ? "#06060e" : C.textSub, fontWeight: showLayman ? 700 : 400 }}>
                Plain English
              </button>
            </div>
          )}
          {p.laymanTitle && showLayman && (
            <div style={{ fontFamily:fB, fontSize:13, fontWeight:700, color:C.accentBright, marginBottom:10 }}>
              "{p.laymanTitle}"
            </div>
          )}

          <div style={{ fontFamily:fB, fontSize:12, color:C.accentBright, fontStyle:"italic", marginBottom:8, lineHeight:1.5 }}>
            Why you need this: {p.why}
          </div>
          <div style={{ fontFamily:fB, fontSize:13, lineHeight:1.75 }}>
            <AnatomicalText text={p.how} style={{ color:C.text }} />
          </div>
          <div style={{ display:"flex", gap:10, marginTop:14 }}>
            <div style={{ flex:1, background:C.surface, borderRadius:8, padding:"10px 12px" }}>
              <div style={{ fontFamily:fM, fontSize:9, color:C.textDim, marginBottom:3 }}>TIMEFRAME</div>
              <div style={{ fontFamily:fB, fontSize:12, color:C.gold }}>{p.timeframe}</div>
            </div>
            <div style={{ flex:1, background:C.surface, borderRadius:8, padding:"10px 12px" }}>
              <div style={{ fontFamily:fM, fontSize:9, color:C.textDim, marginBottom:3 }}>DIFFICULTY</div>
              <div style={{ fontFamily:fB, fontSize:12, color:C.text }}>{p.difficulty}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ── Daily reset + streak system ──────────────────────────────────────────
const STREAK_KEY   = "biomax_streak_count";
const STREAK_DATE  = "biomax_streak_date";   // last date exercises were ALL done
const DONE_DATE    = "biomax_done_date";     // date the done-flags belong to

function todayStr() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

// Returns true if the stored done-flags are from a previous day (needs reset)
function needsDailyReset() {
  try {
    const stored = localStorage.getItem(DONE_DATE);
    return stored !== todayStr();
  } catch { return false; }
}

// Wipe all exercise done-flags and stamp today's date
function resetDailyFlags(exercises) {
  try {
    (exercises || []).forEach(ex => {
      const key = `biomax_done_${(ex.title||"").replace(/\s+/g,"_").toLowerCase()}`;
      localStorage.removeItem(key);
    });
    localStorage.setItem(DONE_DATE, todayStr());
  } catch {}
}

// Call once when all exercises are completed — updates streak
function recordStreakDay() {
  try {
    const lastDate = localStorage.getItem(STREAK_DATE);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);
    const today = todayStr();
    if (lastDate === today) return; // already recorded today
    const current = parseInt(localStorage.getItem(STREAK_KEY) || "0");
    const newStreak = lastDate === yesterdayStr ? current + 1 : 1;
    localStorage.setItem(STREAK_KEY, String(newStreak));
    localStorage.setItem(STREAK_DATE, today);
    recordTechniqueUnlocks(newStreak); // unlock techniques at milestones
  } catch {}
}

function getStreak() {
  try { return parseInt(localStorage.getItem(STREAK_KEY) || "0"); } catch { return 0; }
}

// ── Streak Banner shown at top of exercises tab ───────────────────────────
function StreakBanner({ exercises, doneCount }) {
  const total = exercises.length;
  const streak = getStreak();
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
  const allDone = doneCount >= total && total > 0;

  // Milestone labels
  const milestones = [
    { days:3,   icon:"🔥", label:"3-day streak" },
    { days:7,   icon:"🌟", label:"1-week streak" },
    { days:14,  icon:"💎", label:"2-week streak" },
    { days:30,  icon:"🏆", label:"30-day streak" },
    { days:60,  icon:"👑", label:"60-day streak" },
    { days:100, icon:"🌟", label:"100-day streak" },
  ];
  const nextMilestone = milestones.find(m => streak < m.days);
  const lastMilestone = [...milestones].reverse().find(m => streak >= m.days);

  return (
    <div style={{ ...sec, marginBottom:16, padding:"18px 20px",
      background:`linear-gradient(135deg,rgba(255,215,0,0.06),rgba(0,255,136,0.04),${C.card})`,
      border:`1px solid ${allDone ? "rgba(0,255,136,0.35)" : "rgba(255,215,0,0.2)"}`,
      transition:"border-color .4s" }}>

      {/* Top row: streak + count */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ fontSize:22, lineHeight:1 }}>{streak >= 7 ? "🌟" : streak >= 3 ? "🔥" : "💪"}</div>
          <div>
            <div style={{ fontFamily:fM, fontSize:9, color:C.textDim, letterSpacing:"0.14em" }}>CURRENT STREAK</div>
            <div style={{ display:"flex", alignItems:"baseline", gap:4 }}>
              <span style={{ fontFamily:fH, fontSize:26, color:C.gold, lineHeight:1 }}>{streak}</span>
              <span style={{ fontFamily:fB, fontSize:12, color:C.textSub }}>day{streak !== 1 ? "s" : ""}</span>
            </div>
          </div>
        </div>
        <div style={{ textAlign:"right" }}>
          <div style={{ fontFamily:fM, fontSize:9, color:C.textDim, letterSpacing:"0.14em", marginBottom:2 }}>TODAY</div>
          <div style={{ fontFamily:fB, fontSize:22, fontWeight:700,
            color: allDone ? "#00FF88" : C.text }}>
            {doneCount}<span style={{ fontSize:14, color:C.textSub }}>/{total}</span>
          </div>
          {allDone && (
            <div style={{ fontFamily:fM, fontSize:9, color:"#00FF88", letterSpacing:"0.1em", marginTop:2 }}>
              ✓ ALL DONE
            </div>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ height:6, background:C.surface, borderRadius:3, marginBottom:12, overflow:"hidden" }}>
        <div style={{ height:"100%", borderRadius:3, transition:"width .5s ease",
          width:`${pct}%`,
          background: allDone
            ? "linear-gradient(90deg,#00FF88,#00CC6A)"
            : `linear-gradient(90deg,${C.gold},${C.accentBright})` }}/>
      </div>

      {/* Milestone / next goal */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        {lastMilestone && (
          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
            <span style={{ fontSize:14 }}>{lastMilestone.icon}</span>
            <span style={{ fontFamily:fM, fontSize:9, color:C.gold }}>{lastMilestone.label} reached!</span>
          </div>
        )}
        {nextMilestone && (
          <div style={{ fontFamily:fM, fontSize:9, color:C.textDim, marginLeft:"auto" }}>
            Next: <span style={{ color:C.accent }}>{nextMilestone.icon} {nextMilestone.label}</span>
            {" "}in <span style={{ color:C.text, fontWeight:700 }}>{nextMilestone.days - streak}d</span>
          </div>
        )}
      </div>

      {/* Resets at midnight note */}
      <div style={{ fontFamily:fM, fontSize:9, color:C.textDim, marginTop:8, textAlign:"center" }}>
        🔄 Exercises reset daily at midnight · Complete all to grow your streak
      </div>
    </div>
  );
}

// ── Exercise Card with how-to steps ──────────────────────────────────────
function ExerciseCard({ ex, index }) {
  const [open, setOpen] = useState(false);
  const [showLayman, setShowLayman] = useState(false);
  const storageKey = `biomax_done_${(ex.title||"").replace(/\s+/g,"_").toLowerCase()}`;
  const [done, setDone] = useState(() => {
    try {
      if (needsDailyReset()) return false; // new day — treat as undone (reset happens in banner)
      return localStorage.getItem(storageKey) === "1";
    } catch { return false; }
  });
  const [pop, setPop] = useState(false);

  const toggleDone = (e) => {
    e.stopPropagation();
    const next = !done;
    setDone(next);
    try {
      localStorage.setItem(DONE_DATE, todayStr()); // stamp today so flags are valid
      next ? localStorage.setItem(storageKey,"1") : localStorage.removeItem(storageKey);
    } catch {}
    if (next) { setPop(true); setTimeout(() => setPop(false), 600); }
  };

  const pc = { High:C.red, Medium:C.accent, Foundation:C.gold }[ex.priority] || C.accent;
  const catColors = {
    "Craniofacial": C.blue, "Fascia": C.purple, "Posture": C.green,
    "Skin": C.accent, "Hair": C.gold, "Body": C.cyan,
    "Asymmetry": "#FF6EE7", "Eyes": "#7FBAFF", "Recovery": "#5FE8B0",
    "Craniosacral": "#B066FF", "Cervical": "#FF8C66"
  };
  const normCat = (() => { if (!ex.category) return "Craniofacial"; const c = ex.category.toLowerCase().trim(); if (c.includes("eye")||c.includes("canthal")||c.includes("orbital")) return "Eyes"; if (c.includes("posture")||c.includes("structure")) return "Posture"; if (c.includes("fascia")||c.includes("soft tissue")||c.includes("tissue")) return "Fascia"; if (c.includes("asymm")) return "Asymmetry"; if (c.includes("craniosacral")||c.includes("cranial")) return "Craniosacral"; if (c.includes("skin")||c.includes("acne")) return "Skin"; if (c.includes("hair")||c.includes("scalp")) return "Hair"; if (c.includes("body")) return "Body"; if (c.includes("recover")) return "Recovery"; if (c.includes("cervical")) return "Cervical"; return "Craniofacial"; })();
  const catColor = catColors[normCat] || C.accent;

  return (
    <div style={{ background: done ? "rgba(0,255,136,0.04)" : C.card,
      border:`1px solid ${done ? "rgba(0,255,136,0.3)" : open ? catColor+"66" : C.border}`,
      borderRadius:12, marginBottom:10, overflow:"hidden", transition:"all .3s",
      boxShadow: done ? "0 0 18px rgba(0,255,136,0.08)" : open ? `0 0 24px ${catColor}22` : "none" }}>
      <button onClick={()=>setOpen(o=>!o)}
        style={{ width:"100%", background:"none", border:"none", padding:"12px 14px", cursor:"pointer",
          display:"flex", alignItems:"center", gap:10, textAlign:"left" }}>
        <div style={{ position:"relative", flexShrink:0 }}>
          <div style={{ width:32, height:32, borderRadius:8,
            background: done ? "rgba(0,255,136,0.15)" : `${catColor}22`,
            border:`1px solid ${done ? "rgba(0,255,136,0.4)" : catColor+"44"}`,
            display:"flex", alignItems:"center", justifyContent:"center", fontSize:16,
            transition:"all .3s", filter: done ? "grayscale(0.4)" : "none" }}>
            {ex.icon}
          </div>
          {pop && (
            <div style={{ position:"absolute", inset:-6, borderRadius:14,
              border:"2px solid rgba(0,255,136,0.7)",
              animation:"ringBurst .5s ease-out forwards", pointerEvents:"none" }}/>
          )}
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:"flex", gap:6, alignItems:"center", marginBottom:3, flexWrap:"wrap" }}>
            <span style={{ fontFamily:fB, fontSize:12, fontWeight:700,
              color: done ? C.textSub : C.text,
              textDecoration: done ? "line-through" : "none",
              transition:"all .3s" }}>{ex.title}</span>
            <span style={{ fontFamily:fM, fontSize:8, color:pc, border:`1px solid ${pc}44`, borderRadius:4, padding:"1px 4px", whiteSpace:"nowrap" }}>{ex.priority}</span>
            <span style={{ fontFamily:fM, fontSize:8, color:catColor, border:`1px solid ${catColor}33`, borderRadius:4, padding:"1px 4px", whiteSpace:"nowrap" }}>{normCat}</span>
          </div>
          {ex.laymanTitle && (
            <div style={{ fontFamily:fB, fontSize:11, color:C.textDim, marginBottom:2 }}>
              Also known as: <span style={{ color:C.accent }}>{ex.laymanTitle}</span>
            </div>
          )}
          <div style={{ fontFamily:fB, fontSize:11, color:C.textSub }}>
            {ex.targetedAt && <span>🎯 {ex.laymanTarget || ex.targetedAt} · </span>}
            {ex.sets}
          </div>
        </div>
        <button onClick={toggleDone}
          style={{ width:28, height:28, borderRadius:"50%", cursor:"pointer", flexShrink:0,
            display:"flex", alignItems:"center", justifyContent:"center",
            background: done ? "rgba(0,255,136,0.2)" : "rgba(255,255,255,0.05)",
            border: `2px solid ${done ? "rgba(0,255,136,0.6)" : "rgba(255,255,255,0.1)"}`,
            transition:"all .25s", transform: pop ? "scale(1.25)" : "scale(1)" }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <polyline points="2,7 5.5,10.5 12,3.5"
              stroke={done ? "#00FF88" : "rgba(255,255,255,0.2)"}
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ transition:"stroke .25s" }}/>
          </svg>
        </button>
        <span style={{ color:C.accent, fontSize:16, transform:open?"rotate(90deg)":"none", transition:"transform .2s", flexShrink:0, marginLeft:4 }}>›</span>
      </button>

      {open && (
        <div style={{ padding:"0 18px 20px" }}>
          <div style={{ height:1, background:C.border, marginBottom:16 }}/>

          {/* Layman / Anatomical toggle */}
          {ex.laymanTitle && (
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14 }}>
              <button onClick={()=>setShowLayman(false)}
                style={{ fontFamily:fM, fontSize:10, padding:"4px 12px", borderRadius:20, border:"none", cursor:"pointer",
                  background: !showLayman ? C.accent : C.surface,
                  color: !showLayman ? "#06060e" : C.textSub, fontWeight: !showLayman ? 700 : 400 }}>
                Anatomical
              </button>
              <button onClick={()=>setShowLayman(true)}
                style={{ fontFamily:fM, fontSize:10, padding:"4px 12px", borderRadius:20, border:"none", cursor:"pointer",
                  background: showLayman ? C.accent : C.surface,
                  color: showLayman ? "#06060e" : C.textSub, fontWeight: showLayman ? 700 : 400 }}>
                Plain English
              </button>
              <span style={{ fontFamily:fM, fontSize:9, color:C.textDim }}>tap to switch view</span>
            </div>
          )}

          {/* Title in chosen mode */}
          {ex.laymanTitle && showLayman && (
            <div style={{ fontFamily:fB, fontSize:14, fontWeight:700, color:C.accentBright, marginBottom:10 }}>
              "{ex.laymanTitle}" — {ex.laymanTarget || ex.targetedAt}
            </div>
          )}

          <div style={{ display:"flex", gap:8, marginBottom:14, flexWrap:"wrap" }}>
            {ex.sets && (
              <div style={{ background:`${catColor}18`, border:`1px solid ${catColor}55`, borderRadius:6, padding:"5px 10px" }}>
                <span style={{ fontFamily:fM, fontSize:10, color:catColor }}>⏱ {ex.sets}</span>
              </div>
            )}
          </div>

          {/* Why */}
          <div style={{ fontFamily:fB, fontSize:12, color:C.accentBright, fontStyle:"italic",
            marginBottom:14, lineHeight:1.6, padding:"10px 12px",
            background:C.accentGlow, borderRadius:8 }}>
            Why: {ex.why}
          </div>

          {/* Starting position — prominent */}
          {ex.startPosition && (
            <div style={{ background:"rgba(127,186,255,0.08)", border:`1px solid rgba(127,186,255,0.25)`,
              borderRadius:8, padding:"10px 14px", marginBottom:14, display:"flex", gap:10, alignItems:"flex-start" }}>
              <span style={{ fontSize:16, flexShrink:0 }}>📍</span>
              <div>
                <div style={{ fontFamily:fM, fontSize:9, color:"#7FBAFF", letterSpacing:"0.1em", marginBottom:3 }}>STARTING POSITION</div>
                <div style={{ fontFamily:fB, fontSize:12, color:C.text, lineHeight:1.55 }}>{ex.startPosition}</div>
              </div>
            </div>
          )}

          {/* How-to steps */}
          <div style={{ marginBottom:14 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
              <div style={{ fontFamily:fM, fontSize:10, color:C.textDim, letterSpacing:"0.12em" }}>HOW TO PERFORM</div>
              <div style={{ fontFamily:fM, fontSize:9, color:"#7FBAFF", opacity:0.7 }}>tap <span style={{ background:"rgba(127,186,255,0.15)", border:"1px solid rgba(127,186,255,0.3)", borderRadius:3, padding:"0 3px" }}>blue terms</span> for plain English</div>
            </div>
            <div style={{ fontFamily:fB, fontSize:13, lineHeight:1.85,
              background:C.surface, borderRadius:10, padding:"14px 16px",
              border:`1px solid ${C.border}`, whiteSpace:"pre-wrap" }}>
              <AnatomicalText text={ex.howTo} style={{ color:C.text }} />
            </div>
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:12 }}>
            <div style={{ background:C.surface, borderRadius:8, padding:"10px 12px" }}>
              <div style={{ fontFamily:fM, fontSize:9, color:C.textDim, marginBottom:3 }}>TIMEFRAME</div>
              <div style={{ fontFamily:fB, fontSize:12, color:C.gold }}>{ex.timeframe}</div>
            </div>
            <div style={{ background:C.surface, borderRadius:8, padding:"10px 12px" }}>
              <div style={{ fontFamily:fM, fontSize:9, color:C.textDim, marginBottom:3 }}>DIFFICULTY</div>
              <div style={{ fontFamily:fB, fontSize:12, color:C.text }}>{ex.difficulty}</div>
            </div>
          </div>

          {/* Potential score boost */}
          {ex.scorePotential && (
            <div style={{ background:`linear-gradient(135deg,rgba(255,215,0,0.08),rgba(0,255,136,0.08))`,
              border:`1px solid rgba(255,215,0,0.3)`, borderRadius:10, padding:"12px 14px",
              display:"flex", alignItems:"center", gap:12 }}>
              <div style={{ fontSize:22 }}>🚀</div>
              <div>
                <div style={{ fontFamily:fM, fontSize:9, color:"rgba(255,215,0,0.7)", letterSpacing:"0.12em", marginBottom:3 }}>SCORE POTENTIAL</div>
                <div style={{ fontFamily:fH, fontSize:17, color:"#FFD700", fontWeight:600, lineHeight:1 }}>
                  +{ex.scorePotential} pts
                  <span style={{ fontFamily:fB, fontSize:11, color:C.textSub, fontWeight:400, marginLeft:8 }}>
                    if followed consistently
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Supplement Card ───────────────────────────────────────────────────────
function SupplementCard({ s }) {
  const priorityColors = { Essential: C.red, Recommended: C.accent, Optional: C.textSub };
  const pc = priorityColors[s.priority] || C.accent;
  return (
    <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:10, padding:"11px 12px",
      borderLeft:`3px solid ${pc}` }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:4 }}>
        <div style={{ fontFamily:fB, fontSize:13, fontWeight:700, color:C.text }}>{s.name}</div>
        {s.priority && <span style={{ fontFamily:fM, fontSize:9, color:pc, border:`1px solid ${pc}44`,
          borderRadius:4, padding:"1px 6px", flexShrink:0, marginLeft:6 }}>{s.priority}</span>}
      </div>
      <div style={{ fontFamily:fM, fontSize:11, color:C.accent, marginBottom:4 }}>{s.dose} · {s.timing}</div>
      {s.targets && <div style={{ fontFamily:fM, fontSize:9, color:C.cyan, marginBottom:4, letterSpacing:"0.05em" }}>🎯 {s.targets}</div>}
      <div style={{ fontFamily:fB, fontSize:11, color:C.textSub, lineHeight:1.5 }}>{s.benefit}</div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// METRIC PROGRESSION CHART
// ══════════════════════════════════════════════════════════════════════════
function MetricChart({ savedProfile, weekUpdates }) {
  const [activeMetric, setActiveMetric] = useState(null);

  const metrics = [
    { key:"symmetry",     label:"Symmetry",      color:"#C8A46A" },
    { key:"canthalTilt",  label:"Canthal Tilt",  color:"#7FBAFF" },
    { key:"goldenRatio",  label:"Golden Ratio",  color:"#FF6EE7" },
    { key:"facialThirds", label:"Facial Thirds", color:"#00FF88" },
    { key:"jawDefinition",label:"Jaw",           color:"#FFD700" },
  ];

  const weekPoints = [
    { week:1, label:"W1", faceScores: savedProfile?.faceScores || {} },
    ...weekUpdates.map(u => ({ week:u.week, label:`W${u.week}`, faceScores: u.faceScores || {} }))
  ].sort((a,b) => a.week - b.week);

  const n = weekPoints.length;
  const chartW = 300; const chartH = 140;
  const padL = 28; const padR = 12; const padT = 14; const padB = 24;
  const innerW = chartW - padL - padR;
  const innerH = chartH - padT - padB;

  const toX = (i) => padL + (n <= 1 ? innerW/2 : (i / (n-1)) * innerW);
  // Dynamic Y domain: zoom to data range with 5pt padding so lines show meaningful change
  const allVals = metrics.flatMap(m => weekPoints.map(wp => wp.faceScores[m.key] || 0)).filter(v => v > 0);
  const rawMin = allVals.length ? Math.min(...allVals) : 40;
  const rawMax = allVals.length ? Math.max(...allVals) : 80;
  const yPad   = Math.max(5, Math.ceil((rawMax - rawMin) * 0.25));
  const yMin   = Math.max(0,   Math.floor(rawMin - yPad));
  const yMax   = Math.min(100, Math.ceil(rawMax  + yPad));
  const yRange = yMax - yMin || 10;
  const toY = (v) => padT + innerH - ((Math.max(yMin, Math.min(yMax, v||0)) - yMin) / yRange) * innerH;

  const gains = metrics.map(m => {
    const base = weekPoints[0].faceScores[m.key] || 0;
    const latest = weekPoints[n-1].faceScores[m.key] || 0;
    return { ...m, gain: latest - base };
  });
  const topGain = gains.reduce((a,b) => b.gain > a.gain ? b : a, gains[0]);
  const totalGain = gains.reduce((s,g) => s + Math.max(0, g.gain), 0);
  const shown = activeMetric ? metrics.filter(m => m.key === activeMetric) : metrics;

  return (
    <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14,
      padding:"18px 20px", marginBottom:24, animation:"fadeUp .4s ease both" }}>

      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
        <div>
          <div style={{ fontFamily:fM, fontSize:9, color:C.accentDim, letterSpacing:"0.18em", marginBottom:3 }}>METRIC PROGRESSION</div>
          <div style={{ fontFamily:fB, fontSize:11, color:C.textSub }}>{n} weeks tracked</div>
        </div>
        {topGain.gain > 0 && (
          <div style={{ background:"rgba(0,255,136,0.08)", border:"1px solid rgba(0,255,136,0.25)",
            borderRadius:8, padding:"5px 10px", textAlign:"center" }}>
            <div style={{ fontFamily:fH, fontSize:16, color:"#00FF88", lineHeight:1 }}>+{topGain.gain}</div>
            <div style={{ fontFamily:fM, fontSize:8, color:"rgba(0,255,136,0.6)", letterSpacing:"0.08em" }}>{topGain.label.toUpperCase()}</div>
          </div>
        )}
      </div>

      {/* Filter pills */}
      <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:14 }}>
        <button onClick={() => setActiveMetric(null)}
          style={{ fontFamily:fM, fontSize:9, padding:"3px 10px", borderRadius:20, cursor:"pointer",
            background: !activeMetric ? "rgba(200,164,106,0.15)" : "transparent",
            border:`1px solid ${!activeMetric ? C.accent : C.border}`,
            color: !activeMetric ? C.accent : C.textDim }}>ALL</button>
        {metrics.map(m => (
          <button key={m.key} onClick={() => setActiveMetric(activeMetric === m.key ? null : m.key)}
            style={{ fontFamily:fM, fontSize:9, padding:"3px 10px", borderRadius:20, cursor:"pointer",
              background: activeMetric === m.key ? m.color+"22" : "transparent",
              border:`1px solid ${activeMetric === m.key ? m.color : C.border}`,
              color: activeMetric === m.key ? m.color : C.textDim }}>
            {m.label}
          </button>
        ))}
      </div>

      {/* SVG Chart */}
      <svg width="100%" viewBox={`0 0 ${chartW} ${chartH}`} style={{ display:"block", overflow:"visible" }}>
        <defs>
          {metrics.map(m => (
            <linearGradient key={m.key} id={`grad_${m.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={m.color} stopOpacity="0.18"/>
              <stop offset="100%" stopColor={m.color} stopOpacity="0"/>
            </linearGradient>
          ))}
        </defs>
        {[yMin, Math.round(yMin + yRange*0.33), Math.round(yMin + yRange*0.67), yMax].map(v => {
          const y = toY(v);
          return (
            <g key={v}>
              <line x1={padL} y1={y} x2={padL+innerW} y2={y}
                stroke={C.border} strokeWidth="0.8" strokeDasharray="3 4" opacity="0.45"/>
              <text x={padL-4} y={y+3} textAnchor="end" fontSize="7" fill={C.textDim} fontFamily="monospace">{v}</text>
            </g>
          );
        })}
        {weekPoints.map((wp,i) => (
          <text key={i} x={toX(i)} y={chartH-2} textAnchor="middle"
            fontSize="8" fill={C.textDim} fontFamily="monospace">{wp.label}</text>
        ))}
        {shown.map(m => {
          const pts = weekPoints.map((wp,i) => {
            const v = wp.faceScores[m.key] || 0;
            return { x:toX(i), y:toY(v), v };
          });
          const linePts = pts.map(p => `${p.x},${p.y}`).join(" ");
          const areaD = n > 1 ? [
            `M ${pts[0].x} ${pts[0].y}`,
            ...pts.slice(1).map(p => `L ${p.x} ${p.y}`),
            `L ${pts[n-1].x} ${padT+innerH}`,
            `L ${pts[0].x} ${padT+innerH}`, "Z"
          ].join(" ") : "";
          return (
            <g key={m.key}>
              {n > 1 && <path d={areaD} fill={`url(#grad_${m.key})`}/>}
              {n > 1 && <polyline points={linePts} fill="none" stroke={m.color}
                strokeWidth={activeMetric === m.key ? "2.5" : "1.8"}
                strokeLinejoin="round" strokeLinecap="round"
                opacity={activeMetric && activeMetric !== m.key ? 0.2 : 1}/>}
              {pts.map((p,i) => {
                const isLast = i === n-1;
                const gain = p.v - (pts[0].v);
                return (
                  <g key={i}>
                    {isLast && <circle cx={p.x} cy={p.y} r="7" fill={m.color} opacity="0.12"/>}
                    <circle cx={p.x} cy={p.y} r={isLast ? 4 : 3}
                      fill={isLast ? m.color : C.surface} stroke={m.color} strokeWidth="1.8"
                      opacity={activeMetric && activeMetric !== m.key ? 0.2 : 1}/>
                    {(isLast || activeMetric === m.key) && (
                      <text x={p.x} y={p.y-8} textAnchor="middle" fontSize="8"
                        fill={m.color} fontFamily="monospace" fontWeight="700"
                        opacity={activeMetric && activeMetric !== m.key ? 0.2 : 1}>{p.v}</text>
                    )}
                    {isLast && gain !== 0 && (
                      <text x={p.x} y={p.y-17} textAnchor="middle" fontSize="7"
                        fill={gain > 0 ? "#00FF88" : "#FF4455"} fontFamily="monospace"
                        opacity={activeMetric && activeMetric !== m.key ? 0.15 : 0.9}>
                        {gain > 0 ? "+" : ""}{gain}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div style={{ display:"flex", flexWrap:"wrap", gap:"8px 14px", marginTop:10 }}>
        {metrics.map(m => {
          const base = weekPoints[0].faceScores[m.key] || 0;
          const latest = weekPoints[n-1].faceScores[m.key] || 0;
          const gain = latest - base;
          return (
            <div key={m.key} style={{ display:"flex", alignItems:"center", gap:5,
              opacity: activeMetric && activeMetric !== m.key ? 0.3 : 1 }}>
              <div style={{ width:8, height:8, borderRadius:"50%", background:m.color, flexShrink:0 }}/>
              <span style={{ fontFamily:fM, fontSize:9, color:C.textSub }}>{m.label}</span>
              <span style={{ fontFamily:fM, fontSize:9, color: gain>0?"#00FF88":gain<0?"#FF4455":C.textDim }}>
                {latest > 0 ? `${latest}` : "—"}{gain !== 0 && base > 0 ? ` (${gain>0?"+":""}${gain})` : ""}
              </span>
            </div>
          );
        })}
      </div>

      {/* Motivation bar */}
      <div style={{ marginTop:12, padding:"9px 12px", borderRadius:8,
        background: totalGain>=15?"rgba(255,215,0,0.08)":totalGain>=8?"rgba(0,255,136,0.07)":"rgba(200,164,106,0.06)",
        border:`1px solid ${totalGain>=15?"rgba(255,215,0,0.22)":totalGain>=8?"rgba(0,255,136,0.18)":"rgba(200,164,106,0.15)"}` }}>
        <div style={{ fontFamily:fB, fontSize:11, lineHeight:1.55,
          color: totalGain>=15?"#FFD700":totalGain>=8?"#00FF88":C.accentDim }}>
          {totalGain>=20 ? "🔥 Elite-tier progression across every metric. Remarkable." :
           totalGain>=15 ? "⚡ Strong multi-metric gains. Your face is responding to the work." :
           totalGain>=8  ? "📈 Solid improvements across key metrics. Stay consistent." :
           totalGain>=3  ? "✅ Early gains are showing. Each week compounds." :
                           "💪 Baseline set. Metrics will climb as the routine takes hold."}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// MODEL COMP CARD — downloadable canvas card after Week 4
// ══════════════════════════════════════════════════════════════════════════
function ModelCompCard({ analysis, weekUpdates, userInfo, frontalPhoto, w4FrontalPhoto }) {
  const finalCanvasRef = useRef(null);
  const baselineCanvasRef = useRef(null);
  const [shareError, setShareError]     = useState(null);

  const w4 = weekUpdates.find(u => u.week === 4);
  const finalScore      = w4?.currentScore       ?? analysis?.overallScore ?? 0;
  const finalFaceScores = w4?.faceScores          ?? analysis?.faceScores   ?? {};
  const smvLabel        = w4?.smvLabel            ?? analysis?.smvLabel     ?? "";
  const baseScore       = analysis?.overallScore  ?? 0;
  const baseFaceScores  = analysis?.faceScores    ?? {};
  const totalGain       = finalScore - baseScore;

  const metrics = [
    { key:"symmetry",     label:"Symmetry",       color:"#C8A46A" },
    { key:"canthalTilt",  label:"Canthal Tilt",   color:"#7FBAFF" },
    { key:"goldenRatio",  label:"Golden Ratio",   color:"#FF6EE7" },
    { key:"facialThirds", label:"Facial Thirds",  color:"#00FF88" },
    { key:"jawDefinition",label:"Jaw Definition", color:"#FFD700" },
  ];

  function scoreCol(s) {
    return s >= 94 ? "#FFD700" : s >= 88 ? "#C8A46A" : s >= 80 ? "#00CC66" :
           s >= 72 ? "#00FF88" : s >= 62 ? "#FFEA00" : s >= 52 ? "#FF9500" : "#FF4455";
  }

  // Draw a comp card in the style of the reference: circular photo top-center,
  // 2-column metric grid with label / big number / bar, dark background throughout
  function drawCard(canvas, variant, compact = false) {
    if (!canvas) return;
    const W = compact ? 340 : 480;
    const H = compact ? 538 : 760;

    // Scale canvas buffer for device pixel ratio — keeps text/lines sharp on retina
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width  = W + "px";
    canvas.style.height = H + "px";

    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    const isFinal    = variant === "final";
    const score      = isFinal ? finalScore      : baseScore;
    const faceScores = isFinal ? finalFaceScores : baseFaceScores;
    const col        = scoreCol(score);

    // Potential = baseline + all exercise score potentials, capped by baseline tier
    const rawPotential = Math.min(100,
      baseScore + (analysis?.exercises || []).reduce((s, ex) => s + (ex.scorePotential || 0), 0)
    );
    const maxSpread = baseScore >= 80 ? 15 : baseScore >= 70 ? 20 : baseScore >= 60 ? 25 : 30;
    const potentialScore = Math.min(rawPotential, baseScore + maxSpread);
    const potentialCol = scoreCol(potentialScore);

    // Site fonts matching app theme
    const FONT_H = "\'Cormorant Garamond\', Georgia, serif";
    const FONT_M = "\'JetBrains Mono\', \'Courier New\', monospace";
    const FONT_B = "\'DM Sans\', \'Helvetica Neue\', sans-serif";

    const drawContent = (img) => {
      // Background
      ctx.fillStyle = "#08080f";
      ctx.fillRect(0, 0, W, H);

      // Top accent gradient line
      const topGrad = ctx.createLinearGradient(0, 0, W, 0);
      topGrad.addColorStop(0, "rgba(0,0,0,0)");
      topGrad.addColorStop(0.5, col);
      topGrad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = topGrad;
      ctx.fillRect(0, 0, W, 2);

      // Circular photo
      const CX = W / 2, CY = compact ? 80 : 108, R = compact ? 50 : 70;

      // Glow ring behind photo
      const glow = ctx.createRadialGradient(CX, CY, R, CX, CY, R + 22);
      glow.addColorStop(0, col + "44");
      glow.addColorStop(1, "transparent");
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(CX, CY, R + 22, 0, Math.PI * 2); ctx.fill();

      // Coloured ring
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(CX, CY, R + 3, 0, Math.PI * 2); ctx.stroke();

      // Photo circle clip
      ctx.save();
      ctx.beginPath(); ctx.arc(CX, CY, R, 0, Math.PI * 2); ctx.clip();
      if (img) {
        const size = Math.min(img.width, img.height);
        const sx = (img.width - size) / 2, sy = (img.height - size) / 2;
        ctx.drawImage(img, sx, sy, size, size, CX - R, CY - R, R * 2, R * 2);
      } else {
        ctx.fillStyle = "#141428";
        ctx.fillRect(CX - R, CY - R, R * 2, R * 2);
      }
      ctx.restore();

      // Variant badge — JetBrains Mono, top center, gold
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = col;
      ctx.font = `500 10px ${FONT_M}`;
      ctx.fillText(isFinal ? "4-WEEK RESULTS" : "WEEK 1 BASELINE", W / 2, 20);

      // Name below photo — Cormorant Garamond italic light
      const name = (userInfo?.name || "").slice(0, 22);
      if (name) {
        ctx.fillStyle = "#ffffff";
        ctx.font = `300 ${compact ? 20 : 28}px ${FONT_H}`;
        ctx.fillText(name, W / 2, CY + R + 28);
      }

      // Age · height · date — JetBrains Mono, small grey
      const htCm    = userInfo?.height || 170;
      const totalIn = Math.round(htCm / 2.54);
      const ft      = Math.floor(totalIn / 12), inch2 = totalIn % 12;
      const dateStr = new Date().toLocaleDateString("en-GB", { day:"numeric", month:"short", year:"numeric" });
      const infoParts = [
        userInfo?.age ? `${userInfo.age}y` : null,
        `${htCm}cm  ${ft}'${inch2}"`,
        isFinal ? `Completed ${dateStr}` : `Assessed ${dateStr}`,
      ].filter(Boolean).join("  ·  ");
      ctx.fillStyle = "#cccccc";
      ctx.font = `400 ${compact ? 10 : 13}px ${FONT_M}`;
      ctx.fillText(infoParts, W / 2, CY + R + (name ? 48 : 28));

      // 2-col metric grid
      const PAD      = 16;
      const GAP      = 10;
      const cellW    = (W - PAD * 2 - GAP) / 2;
      const cellH    = compact ? 80 : 108;
      const CELL_PAD = 14;
      const BAR_H    = 6;
      const gridY    = CY + R + (name ? 68 : 48);

      // Row 1: Overall | Potential — all bars share the same overall score colour
      const gridItems = [
        { key:"_overall",   label:"Overall",   val: score,          baseVal: baseScore      },
        { key:"_potential", label:"Potential", val: potentialScore, baseVal: potentialScore },
        ...metrics.map(m => ({
          key:     m.key,
          label:   m.label,
          val:     faceScores[m.key] || 0,
          baseVal: baseFaceScores[m.key] || 0,
        })),
      ];

      gridItems.forEach((item, i) => {
        const delta  = isFinal && item.key !== "_potential" ? item.val - item.baseVal : null;
        const row    = Math.floor(i / 2);
        const col_i  = i % 2;
        const isLast = i === gridItems.length - 1 && gridItems.length % 2 === 1;
        const cellX  = isLast ? (W - cellW) / 2 : PAD + col_i * (cellW + GAP);
        const cellY  = gridY + row * (cellH + GAP);

        // Dark card cell with subtle border
        ctx.fillStyle = "#0e0e1a";
        ctx.beginPath(); ctx.roundRect(cellX, cellY, cellW, cellH, 10); ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.04)";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.roundRect(cellX, cellY, cellW, cellH, 10); ctx.stroke();

        // Label — JetBrains Mono, small caps, muted
        ctx.textAlign = "left";
        ctx.fillStyle = "#666677";
        ctx.font = `500 ${compact ? 9 : 11}px ${FONT_M}`;
        ctx.fillText(item.label.toUpperCase(), cellX + CELL_PAD, cellY + (compact ? 16 : 22));

        // Big number — Cormorant Garamond, light weight, white
        ctx.fillStyle = "#ffffff";
        ctx.font = `300 ${compact ? 34 : 58}px ${FONT_H}`;
        ctx.fillText(`${item.val}`, cellX + CELL_PAD, cellY + (compact ? 50 : 72));

        // Delta — DM Sans bold, small, coloured
        if (delta !== null && delta !== 0) {
          const nw = ctx.measureText(`${item.val}`).width;
          ctx.fillStyle = delta > 0 ? "#00CC66" : "#FF4444";
          ctx.font = `700 ${compact ? 10 : 12}px ${FONT_B}`;
          ctx.fillText(`${delta > 0 ? "+" : ""}${delta}`, cellX + CELL_PAD + nw + 4, cellY + (compact ? 43 : 62));
        }

        // Solid colour bar — sits below number with clear gap
        const barX = cellX + CELL_PAD;
        const barW = cellW - CELL_PAD * 2;
        const barY = cellY + cellH - BAR_H - (compact ? 8 : 10);
        ctx.fillStyle = "#181828";
        ctx.beginPath(); ctx.roundRect(barX, barY, barW, BAR_H, BAR_H / 2); ctx.fill();
        const fillW = Math.max(BAR_H, (item.val / 100) * barW);
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.roundRect(barX, barY, fillW, BAR_H, BAR_H / 2); ctx.fill();
      });

      // Bottom accent line
      ctx.fillStyle = topGrad;
      ctx.fillRect(0, H - 2, W, 2);

      // Watermark
      ctx.textAlign = "center";
      ctx.fillStyle = "#252535";
      ctx.font = `400 9px ${FONT_M}`;
      ctx.fillText("thebiomax.app", W / 2, H - 10);


    };

    // Choose the right photo for this variant
    const cardPhoto = isFinal ? (w4FrontalPhoto || frontalPhoto) : frontalPhoto;

    const run = (img) => {
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => drawContent(img));
      } else {
        drawContent(img);
      }
    };

    if (cardPhoto) {
      const img = new window.Image();
      img.onload  = () => run(img);
      img.onerror = () => run(null);
      img.src = cardPhoto;
    } else {
      run(null);
    }
  }
  useEffect(() => {
    drawCard(finalCanvasRef.current, "final", !!w4);
    drawCard(baselineCanvasRef.current, "baseline", !!w4);
  }, [finalScore, baseFaceScores, finalFaceScores, smvLabel, totalGain, userInfo, frontalPhoto, w4FrontalPhoto]);

  const downloadCard = (ref, variant, filename) => {
    const canvas = ref.current;
    if (!canvas) return;
    // Redraw fresh then export
    const doExport = () => {
      try {
        const link = document.createElement("a");
        link.download = filename;
        link.href = canvas.toDataURL("image/png");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch(e) {
        console.error("Download failed:", e);
      }
    };
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(doExport);
    } else {
      doExport();
    }
  };

  const shareCard = async (ref, variant, title) => {
    setShareError(null);
    const canvas = ref.current;
    if (!canvas) return;
    canvas.toBlob(async (blob) => {
      if (!blob) { setShareError("Could not generate image."); return; }
      const file = new File([blob], "biomax-comp-card.png", { type:"image/png" });
      try {
        if (navigator.share && navigator.canShare && navigator.canShare({ files:[file] })) {
          await navigator.share({ files:[file], title, text:"My biohacking results — BioMax" });
        } else {
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
          setShareError("✓ Copied to clipboard — paste anywhere to share!");
        }
      } catch(e) {
        // Final fallback: open image in new tab
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");
        setShareError("Opened in new tab — save from there to share.");
      }
    }, "image/png");
  };

  const ActionRow = ({ canvasRef, variant, filename, shareTitle }) => (
    <div style={{ display:"flex", gap:8, marginTop:12, flexWrap:"wrap" }}>
      <button onClick={() => downloadCard(canvasRef, variant, filename)}
        style={{ flex:1, background:"linear-gradient(135deg,#C8A46A,#FFD700)", border:"none",
          borderRadius:9, padding:"10px 0", cursor:"pointer",
          fontFamily:fB, fontSize:12, fontWeight:700, color:"#06060e", minWidth:110 }}>
        ⬇ Download
      </button>
      <button onClick={() => shareCard(canvasRef, variant, shareTitle)}
        style={{ flex:1, background:"rgba(200,164,106,0.12)", border:"1px solid rgba(200,164,106,0.35)",
          borderRadius:9, padding:"10px 0", cursor:"pointer",
          fontFamily:fB, fontSize:12, fontWeight:700, color:"#C8A46A", minWidth:110 }}>
        ↑ Share
      </button>
    </div>
  );

  return (
    <div style={{ background:`linear-gradient(135deg,${C.card},${C.surface})`,
      border:`1px solid rgba(255,215,0,0.3)`, borderRadius:14, padding:"14px",
      marginBottom:24, animation:"fadeUp .5s ease both" }}>

      {/* Header */}
      <div style={{ marginBottom:20 }}>
        <div style={{ fontFamily:fM, fontSize:9, color:"#FFD700", letterSpacing:"0.2em", marginBottom:4 }}>
          {w4 ? "🏆 WEEK 4 COMPLETE" : "📋 WEEK 1 BASELINE"}
        </div>
        <div style={{ fontFamily:fH, fontSize:20, color:C.text }}>
          {w4 ? "Your Model Comp Cards" : "Your Baseline Comp Card"}
        </div>
        <div style={{ fontFamily:fB, fontSize:12, color:C.textSub, marginTop:2 }}>
          {w4 ? "Download or share your before & after biometric cards" : "Complete Week 4 to unlock your final results card"}
        </div>
      </div>

      {shareError && (
        <div style={{ background:"rgba(200,164,106,0.1)", border:"1px solid rgba(200,164,106,0.3)",
          borderRadius:8, padding:"8px 14px", marginBottom:14, fontFamily:fB, fontSize:12,
          color:"#C8A46A" }}>{shareError}</div>
      )}

      {/* Cards — baseline always shown, final only after week 4 */}
      <div style={{ display:"flex", flexWrap:"wrap", gap:16, justifyContent:"center", alignItems:"flex-start" }}>
        {/* Baseline card */}
        <div style={{ width:"100%", maxWidth: w4 ? 340 : 480, margin:"0 auto" }}>
          <div style={{ fontFamily:fM, fontSize:9, color:C.accentDim, letterSpacing:"0.14em", marginBottom:6, textAlign:"center" }}>WEEK 1 BASELINE</div>
          <div style={{ borderRadius:8, overflow:"hidden", border:`1px solid rgba(200,164,106,0.2)` }}>
            <canvas ref={baselineCanvasRef} style={{ display:"block", maxWidth:"100%", height:"auto" }}/>
          </div>
          <ActionRow canvasRef={baselineCanvasRef} variant="baseline"
            filename="biomax-week1-baseline.png" shareTitle="My Week 1 BioMax Baseline"/>
        </div>

        {/* Final card — only when week 4 done */}
        {w4 && (
          <div style={{ width:"100%", maxWidth:340, margin:"0 auto" }}>
            <div style={{ fontFamily:fM, fontSize:9, color:"#FFD700", letterSpacing:"0.14em", marginBottom:6, textAlign:"center" }}>WEEK 4 FINAL</div>
            <div style={{ borderRadius:8, overflow:"hidden", border:`1px solid rgba(255,215,0,0.25)` }}>
              <canvas ref={finalCanvasRef} style={{ display:"block", maxWidth:"100%", height:"auto" }}/>
            </div>
            <ActionRow canvasRef={finalCanvasRef} variant="final"
              filename="biomax-week4-final.png" shareTitle="My 4-Week BioMax Results"/>
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════════════════════════════════


// ── Badges row component (extracted to avoid IIFE-in-JSX parse issues) ──
function BadgesRow({ analysis, weekUpdates }) {
  const lw = [...weekUpdates].sort((a,b) => b.week - a.week)[0];
  const ds = lw?.currentScore ?? analysis.overallScore;
  const bs = analysis.overallScore;
  const rawPot = Math.min(100, ds + (analysis.exercises||[]).reduce((s,ex) => s + (ex.scorePotential||0), 0));
  const maxSpr = ds >= 80 ? 15 : ds >= 70 ? 20 : ds >= 60 ? 25 : 30;
  const uplift = Math.min(rawPot, ds + maxSpr) - ds;
  const percentile = ds >= 90 ? "TOP 2%" : ds >= 83 ? "TOP 10%" : ds >= 75 ? "TOP 20%" :
                     ds >= 66 ? "TOP 35%" : ds >= 56 ? "ABOVE MEDIAN" : ds >= 46 ? "AT MEDIAN" :
                     ds >= 31 ? "BELOW MEDIAN" : "BOTTOM 25%";
  const bg = ds >= 83 ? "rgba(232,184,75,0.15)" : ds >= 75 ? "rgba(62,201,106,0.12)" :
             ds >= 56 ? "rgba(184,149,90,0.12)" : "rgba(217,79,79,0.12)";
  return (
    <div style={{ display:"flex", gap:8, justifyContent:"center", alignItems:"center", marginTop:14, flexWrap:"wrap" }}>
      <div style={{ display:"inline-flex", alignItems:"center", gap:6, padding:"4px 14px", borderRadius:20,
        background:bg, border:`1px solid ${scoreColor(ds)}44` }}>
        <span style={{ fontFamily:fM, fontSize:11, color:scoreColor(ds), fontWeight:700 }}>
          {ds}/100{lw && ds !== bs ? ` (+${ds-bs})` : ""}
        </span>
        <span style={{ fontFamily:fM, fontSize:9, color:C.textDim }}>·</span>
        <span style={{ fontFamily:fM, fontSize:9, color:C.textSub, letterSpacing:"0.08em" }}>{percentile}</span>
      </div>
      {uplift > 0 && (
        <div style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"4px 14px",
          borderRadius:20, background:"rgba(255,215,0,0.1)", border:"1px solid rgba(255,215,0,0.35)" }}>
          <span style={{ fontFamily:fM, fontSize:11, color:"#FFD700", fontWeight:700 }}>🚀 +{uplift} pts possible</span>
          <span style={{ fontFamily:fM, fontSize:9, color:C.textDim }}>·</span>
          <span style={{ fontFamily:fM, fontSize:9, color:C.textSub, letterSpacing:"0.06em" }}>IF ROUTINE FOLLOWED</span>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [phase, setPhase] = useState("landing");
  const [photos, setPhotos] = useState({ frontal:null, profile:null, torso:null, body:null });
  const [photoFiles, setPhotoFiles] = useState({ frontal:null, profile:null, torso:null, body:null });
  const [validating, setValidating] = useState({});
  const [valid, setValid] = useState({});
  const [errors, setErrors] = useState({});
  const [goals, setGoals] = useState("");
  const [selectedTags, setSelectedTags] = useState([]);
  const [photoContext, setPhotoContext] = useState("selfie");
  const [analysis, setAnalysis] = useState(null);
  const [analysisError, setAnalysisError] = useState(null);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [activeTab, setActiveTab] = useState("face");
  const [isPaid, setIsPaid] = useState(false);
  const [exerciseFilter, setExerciseFilter] = useState("All");
  const [streakTick, setStreakTick] = useState(0); // bump to re-read localStorage counts

  // User biometrics
  const [userInfo, setUserInfo] = useState({ age:25, height:170, weight:160 });

  // Saved profile & week tracking (persisted to storage)
  const [savedProfile, setSavedProfile] = useState(null);
  const [weekUpdates, setWeekUpdates] = useState([]); // [{week:2,date,photos,analysis}]
  const [storageLoaded, setStorageLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState(""); // "saving"|"saved"|"error"
  const [weekPhase, setWeekPhase] = useState(null); // null | 2 | 3 | 4
  const [weekPhotos, setWeekPhotos] = useState({ frontal:null, profile:null, torso:null, body:null });
  const [weekPhotoFiles, setWeekPhotoFiles] = useState({ frontal:null, profile:null, torso:null, body:null });
  const [weekAnalysing, setWeekAnalysing] = useState(false);
  const [weekProgress, setWeekProgress] = useState(0);
  const [weekError, setWeekError] = useState(null);
  const [weekValidating, setWeekValidating] = useState({ frontal:false, profile:false, torso:false, body:false });
  const [weekPhotoErrors, setWeekPhotoErrors] = useState({});

  const photoConfig = [
    { key:"frontal", label:"Frontal Face Photo", icon:"🧑", sublabel:"Look directly at the camera, neutral expression, good lighting", hint:"Front-facing · Good light · No filters" },
    { key:"profile", label:"Side Profile Photo", icon:"👤", sublabel:"Turn 90° to the side, keep head level", hint:"Side view · Ear visible · Natural posture" },
    { key:"torso",   label:"Torso Photo", icon:"👕", sublabel:"Upper body from neck to waist, wear fitted clothing", hint:"Fitted top · Shoulders to waist · Good light" },
    { key:"body",    label:"Full Body Photo", icon:"🏃", sublabel:"Full body from head to feet. Wear tight-fitting clothes so body outline is visible for accurate composition analysis.", hint:"Tight clothes required · Head to feet · Natural stance" },
  ];

  // Load saved profile from storage on mount
  useEffect(() => {
    async function loadProfile() {
      try {
        if (typeof window.storage === "undefined") { setStorageLoaded(true); return; }
        const r = await window.storage.get('looksmaxx_profile');
        if (r && r.value) {
          const data = JSON.parse(r.value);
          setSavedProfile(data.baseAnalysis || null);
          setWeekUpdates(data.weekUpdates || []);
          if (data.userInfo) setUserInfo(u => ({...u, ...data.userInfo}));
          if (data.goals) setGoals(data.goals);
        }
      } catch(e) { console.log('Storage load:', e); }
      setStorageLoaded(true);
    }
    loadProfile();
  }, []);

  const saveProfileToStorage = async (baseAnalysis, weekUpds, info, goalsTxt) => {
    setSaveStatus("saving");
    try {
      if (typeof window.storage === "undefined") { setSaveStatus("error"); return; }
      await window.storage.set('looksmaxx_profile', JSON.stringify({
        baseAnalysis, weekUpdates: weekUpds, userInfo: info, goals: goalsTxt, savedAt: new Date().toISOString()
      }));
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus(""), 2500);
    } catch(e) { console.log('Storage save:', e); setSaveStatus("error"); }
  };

  const clearProfile = async () => {
    try { if (typeof window.storage !== "undefined") await window.storage.delete('looksmaxx_profile'); } catch {}
    setSavedProfile(null); setWeekUpdates([]); setWeekPhase(null);
  };

  // Week update analysis
  async function runWeekAnalysis(weekNum) {
    setWeekAnalysing(true); setWeekError(null); setWeekProgress(5);

    // ALWAYS use Week 1 savedProfile as the baseline — never a week update
    const baseScore   = savedProfile?.overallScore || 0;
    const baseSummary = savedProfile?.summary || "";
    const concerns    = (savedProfile?.detectedConcerns || []).join(", ");
    const baseFaceScores = savedProfile?.faceScores || {};

    // Build a summary of all completed prior weeks for context
    const priorWeeks = weekUpdates
      .filter(u => u.week < weekNum)
      .sort((a,b) => a.week - b.week)
      .map(u => `Week ${u.week}: score ${u.currentScore}/100 (${u.scoreDelta >= 0 ? "+" : ""}${u.scoreDelta} pts)`)
      .join(" → ");

    // Previous week's score is the most recent week update (for scoreDelta calc)
    const lastUpdate = weekUpdates.filter(u => u.week < weekNum).sort((a,b) => b.week - a.week)[0];
    const prevScore = lastUpdate?.currentScore ?? baseScore;
    try {

      const imgs = [];
      if (weekPhotoFiles.frontal) {
        imgs.push({ type:"image", source:{ type:"base64", media_type:weekPhotoFiles.frontal.mediaType, data:weekPhotoFiles.frontal.base64 } });
        imgs.push({ type:"text", text:"[WEEK UPDATE — FRONTAL FACE]" });
      }
      if (weekPhotoFiles.profile) {
        imgs.push({ type:"image", source:{ type:"base64", media_type:weekPhotoFiles.profile.mediaType, data:weekPhotoFiles.profile.base64 } });
        imgs.push({ type:"text", text:"[WEEK UPDATE — SIDE PROFILE]" });
      }
      if (weekPhotoFiles.torso) {
        imgs.push({ type:"image", source:{ type:"base64", media_type:weekPhotoFiles.torso.mediaType, data:weekPhotoFiles.torso.base64 } });
        imgs.push({ type:"text", text:"[WEEK UPDATE — TORSO]" });
      }
      if (weekPhotoFiles.body) {
        imgs.push({ type:"image", source:{ type:"base64", media_type:weekPhotoFiles.body.mediaType, data:weekPhotoFiles.body.base64 } });
        imgs.push({ type:"text", text:"[WEEK UPDATE — FULL BODY]" });
      }
      setWeekProgress(25);
      const bio = userInfo ? (() => {
    const htCm = userInfo.height || 170;
    const totalIn = Math.round(htCm / 2.54);
    const ft = Math.floor(totalIn/12), inch = totalIn%12;
    const kg = Math.round((userInfo.weight||160) * 0.4536);
    return `Age: ${userInfo.age||25}yrs, Height: ${htCm}cm (${ft}'${inch}"), Weight: ${userInfo.weight||160}lbs (${kg}kg).`;
  })() : "";
      const weekPrompt = `${bio} This is Week ${weekNum} progress check for a looksmaxx biohacking programme.

WEEK 1 BASELINE: Score was ${baseScore}/100. Summary: ${baseSummary}. Original concerns: ${concerns}.
${priorWeeks ? `PRIOR WEEKS: ${priorWeeks}` : ""}

Compare the new photos against the Week 1 baseline. The person has been following a dedicated biohacking routine for ${weekNum - 1} week(s).


PROGRESSION SCORING RULES — read carefully:
1. Be GENEROUS. People are working hard. Even minor effort or subtle visible change should push the score up +2 to +5 pts.
2. Week-specific minimums (apply these unless there is visible regression): Week 2 = +2 to +5 pts. Week 3 = +3 to +6 pts. Week 4 = +4 to +8 pts.
3. BALANCE all faceScores — do NOT only improve jawDefinition. Symmetry, canthalTilt, goldenRatio, and facialThirds must ALL show improvement proportional to the overall scoreDelta. If overall goes up +4, each face metric should go up roughly +2 to +6.
4. Do NOT score lower than the previous week unless there is unambiguous visible regression (severe breakouts, significant weight gain).
5. Be specific: name exactly what improved — skin clarity, eye area, posture, jaw definition. People need encouragement.
6. Score MUST be an EVEN number.

ANALYSE:
1. What has visibly improved since Week 1? (skin, jaw, posture, symmetry, puffiness, eye area)
2. What still needs work?
3. What is their current score reflecting genuine progress?
4. What are the top 3 things to focus on for the next 7 days?

Return ONLY this JSON:
{"weekNum":${weekNum},"currentScore":0,"scoreDelta":0,"smvLabel":"Average","faceScores":{"symmetry":0,"canthalTilt":0,"goldenRatio":0,"facialThirds":0,"jawDefinition":0},"progressSummary":"2 specific sentences naming exactly what improved and what is next","improvements":["specific visible improvement 1","specific visible improvement 2","specific visible improvement 3"],"unchanged":["what still needs time"],"nextWeekFocus":["top priority 1","top priority 2","top priority 3"],"updatedConcerns":["remaining concerns"]}

scoreDelta must equal currentScore minus ${prevScore}. currentScore must be even. All faceScores must be even numbers.
For faceScores, compare carefully against Week 1 baseline: symmetry=${baseFaceScores.symmetry||50}, canthalTilt=${baseFaceScores.canthalTilt||50}, goldenRatio=${baseFaceScores.goldenRatio||50}, facialThirds=${baseFaceScores.facialThirds||50}, jawDefinition=${baseFaceScores.jawDefinition||50}. Reward visible progress in each metric independently.`;

      setWeekProgress(50);
      const text = await callClaude([{ role:"user", content:[...imgs, { type:"text", text:weekPrompt }] }], SYS, 1800);
      setWeekProgress(85);
      const weekResult = safeParseJSON(text);
      weekResult.week = weekNum;
      weekResult.date = new Date().toISOString();
      weekResult.photoFrontal = weekPhotos.frontal;

      const newUpdates = [...weekUpdates.filter(u => u.week !== weekNum), weekResult]
        .sort((a,b) => a.week - b.week);
      setWeekUpdates(newUpdates);
      await saveProfileToStorage(savedProfile, newUpdates, userInfo, goals);
      setWeekProgress(100);
      setTimeout(() => { setWeekAnalysing(false); setWeekPhase(null); setWeekPhotos({ frontal:null, profile:null, torso:null, body:null }); setWeekPhotoFiles({ frontal:null, profile:null, torso:null, body:null }); }, 800);
    } catch(e) {
      setWeekError(e.message || "Analysis failed");
      setWeekAnalysing(false);
    }
  }

  const handleWeekPhotoChange = useCallback(async (key, file) => {
    if (!file) {
      setWeekPhotos(p=>({...p,[key]:null}));
      setWeekPhotoFiles(p=>({...p,[key]:null}));
      setWeekPhotoErrors(e=>({...e,[key]:null}));
      return;
    }
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target.result;
      setWeekPhotos(p => ({...p,[key]:dataUrl}));
      setWeekPhotoErrors(e=>({...e,[key]:null}));
      setWeekValidating(v=>({...v,[key]:true}));
      try {
        const mediaType = file.type || "image/jpeg";
        const base64 = dataUrlToBase64(dataUrl);
        const labels = { frontal:"Face Frontal", profile:"Side Profile", torso:"Torso", body:"Full Body" };
        const result = await validateImage(base64, mediaType, labels[key]);
        setWeekValidating(v=>({...v,[key]:false}));
        if (!result.isRealHuman || !result.isCorrectType) {
          setWeekPhotoErrors(e=>({...e,[key]: result.reason || "Invalid photo — please upload a real photo of yourself."}));
          setWeekPhotos(p=>({...p,[key]:null}));
          setWeekPhotoFiles(p=>({...p,[key]:null}));
        } else {
          setWeekPhotoFiles(p=>({...p,[key]:{ base64, mediaType }}));
        }
      } catch {
        setWeekValidating(v=>({...v,[key]:false}));
        const base64 = dataUrlToBase64(dataUrl);
        setWeekPhotoFiles(p=>({...p,[key]:{ base64, mediaType: file.type||"image/jpeg" }}));
      }
    };
    reader.readAsDataURL(file);
  }, []);


  const handlePhotoChange = useCallback(async (key, file) => {
    if (!file) {
      setPhotos(p => ({ ...p, [key]: null }));
      setPhotoFiles(p => ({ ...p, [key]: null }));
      setValid(v => ({ ...v, [key]: false }));
      setErrors(e => ({ ...e, [key]: null }));
      return;
    }
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target.result;
      setPhotos(p => ({ ...p, [key]: dataUrl }));
      setErrors(er => ({ ...er, [key]: null }));
      setValid(v => ({ ...v, [key]: false }));
      setValidating(vl => ({ ...vl, [key]: true }));
      try {
        const mediaType = file.type || "image/jpeg";
        const base64 = dataUrlToBase64(dataUrl);
        const photoTypeLabels = { frontal:"Face Frontal", profile:"Side Profile", torso:"Torso", body:"Full Body" };
        const result = await validateImage(base64, mediaType, photoTypeLabels[key]);
        setValidating(vl => ({ ...vl, [key]: false }));
        if (!result.isRealHuman) {
          setErrors(er => ({ ...er, [key]: result.reason || "This doesn't appear to be a real person. Please upload a genuine photo." }));
          setPhotoFiles(p => ({ ...p, [key]: null }));
        } else if (!result.isCorrectType) {
          setErrors(er => ({ ...er, [key]: result.reason || `Please upload a correct ${photoTypeLabels[key]} photo.` }));
          setPhotoFiles(p => ({ ...p, [key]: null }));
        } else {
          setValid(v => ({ ...v, [key]: true }));
          setPhotoFiles(p => ({ ...p, [key]: { base64, mediaType } }));
        }
      } catch {
        setValidating(vl => ({ ...vl, [key]: false }));
        setValid(v => ({ ...v, [key]: true }));
        setPhotoFiles(p => ({ ...p, [key]: { base64: dataUrlToBase64(dataUrl), mediaType: file.type || "image/jpeg" } }));
      }
    };
    reader.readAsDataURL(file);
  }, []);

  const allValid = Object.values(valid).filter(Boolean).length >= 1 && !Object.values(validating).some(Boolean);
  const frontalValid = valid.frontal;

  const handleAnalyse = async () => {
    setPhase("analysing");
    setAnalysisError(null);
    setProgress(5);
    setProgressLabel("Initialising biometric scan…");
    const onProgress = (pct, label) => { setProgress(pct); setProgressLabel(label); };
    try {
      const result = await runFullAnalysis(photoFiles, goals, userInfo, onProgress, photoContext);
      setProgress(100);
      setProgressLabel("Analysis complete — decoding results…");
      setTimeout(async () => {
        setAnalysis(result);
        setSavedProfile(result);
        setPhase("results");
        // Auto-save to storage
        await saveProfileToStorage(result, [], userInfo, goals);
      }, 600);
    } catch (err) {
      console.error("Analysis error:", err);
      setAnalysisError(err.message || "Unknown error");
      setProgress(0);
      setProgressLabel("Analysis failed");
    }
  };

  const resetApp = () => {
    setPhase("landing");
    setAnalysis(null);
    setPhotos({ frontal:null, profile:null, torso:null, body:null });
    setPhotoFiles({ frontal:null, profile:null, torso:null, body:null });
    setValid({}); setErrors({}); setGoals(""); setSelectedTags([]); setActiveTab("face");
    setExerciseFilter("All"); setWeekPhase(null);
    setWeekPhotos({ frontal:null, profile:null });
    setWeekPhotoFiles({ frontal:null, profile:null });
    setWeekError(null);
  };

  // ─── LANDING ────────────────────────────────────────────────────────────
  if (phase === "landing") return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", flexDirection:"column",
      alignItems:"center", justifyContent:"center", padding:"32px 16px", position:"relative", overflow:"hidden" }}>
      <style>{css}</style>
      {/* Background grid */}
      <div style={{ position:"absolute", inset:0,
        backgroundImage:`linear-gradient(${C.border} 1px, transparent 1px), linear-gradient(90deg, ${C.border} 1px, transparent 1px)`,
        backgroundSize:"60px 60px", opacity:0.3, pointerEvents:"none" }}/>
      <div style={{ position:"absolute", inset:0,
        background:`radial-gradient(ellipse 80% 60% at 50% 30%, rgba(184,149,90,0.07), transparent)`, pointerEvents:"none" }}/>
      {/* Matrix lines */}
      <div style={{ position:"absolute", inset:0, overflow:"hidden", pointerEvents:"none" }}>
        {[...Array(6)].map((_, i) => (
          <div key={i} style={{
            position:"absolute", left:`${(i+1)*15}%`, top:0, width:1, height:"100%",
            background:`linear-gradient(to bottom, transparent, ${C.accent}33, transparent)`,
            animation:`matrixRain ${2+i*0.3}s linear infinite`, animationDelay:`${i*0.4}s`,
          }}/>
        ))}
      </div>

      <div style={{ position:"relative", zIndex:1, textAlign:"center", maxWidth:680, animation:"fadeUp .8s ease both" }}>
        <div style={{ fontFamily:fM, fontSize:9, color:C.accentDim, letterSpacing:"0.38em", marginBottom:32, textTransform:"uppercase" }}>
          ◈&nbsp;&nbsp;Biohacking&nbsp;&nbsp;·&nbsp;&nbsp;Facial Analysis&nbsp;&nbsp;·&nbsp;&nbsp;Progress Tracking&nbsp;&nbsp;◈
        </div>
        <div style={{ position:"relative", marginBottom:4 }}>
          <h1 style={{ fontFamily:fH, fontSize:"clamp(40px,10vw,60px)", fontWeight:300, lineHeight:0.85,
            fontStyle:"italic", color:C.accent, marginBottom:0, letterSpacing:"-0.03em",
            textShadow:"0 0 100px rgba(184,149,90,0.4), 0 4px 60px rgba(184,149,90,0.18)" }}>
            BIOMAX
          </h1>
        </div>
        <div style={{ width:64, height:1, background:`linear-gradient(90deg,transparent,${C.accent},transparent)`, margin:"22px auto 20px" }}/>
        <div style={{ fontFamily:fH, fontSize:"clamp(13px,1.8vw,18px)", color:C.textSub, fontStyle:"italic",
          marginBottom:56, letterSpacing:"0.14em" }}>
          Precision Biohacking &amp; Aesthetics Analysis
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:10, marginBottom:28, textAlign:"left" }}>
          {[
            { icon:"💀", title:"Craniofacial Analysis", desc:"Mewing, buccal massage, hyoid bone, canine fossa, orbital tightening & more" },
            { icon:"🧬", title:"Biometric Face Scan", desc:"Analyses every visible feature" },
            { icon:"💊", title:"Targeted Supplement Stack", desc:"Specific protocols for hair loss, acne, puffiness, hormones" },
            { icon:"⚡", title:"Unique Exercise Plan", desc:"Personalised to your exact concerns" },
          ].map(f => (
            <div key={f.title} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:"14px 12px" }}>
              <div style={{ fontSize:24, marginBottom:8 }}>{f.icon}</div>
              <div style={{ fontFamily:fB, fontSize:13, fontWeight:700, color:C.text, marginBottom:4 }}>{f.title}</div>
              <div style={{ fontFamily:fB, fontSize:11, color:C.textSub, lineHeight:1.5 }}>{f.desc}</div>
            </div>
          ))}
        </div>

        <Btn onClick={() => setPhase("upload")}>Begin Analysis →</Btn>

        {savedProfile && (
          <div style={{ marginTop:20, background:C.card, border:`1px solid ${C.accentDim}`, borderRadius:14, padding:"14px 16px", textAlign:"left" }}>
            <div style={{ fontFamily:fM, fontSize:9, color:C.accentDim, letterSpacing:"0.18em", marginBottom:10 }}>SAVED PROFILE FOUND</div>
            <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:12 }}>
              <div style={{ width:38, height:38, borderRadius:8, background:C.accentGlow, border:`1px solid ${C.accentDim}`,
                display:"flex", alignItems:"center", justifyContent:"center", fontFamily:fH, fontSize:18, color:C.accent }}>
                {savedProfile.overallScore}
              </div>
              <div>
                <div style={{ fontFamily:fB, fontSize:13, fontWeight:700, color:C.text }}>
                  {savedProfile.smvLabel || scoreLabel(savedProfile.overallScore)} · {savedProfile.overallScore}/100
                </div>
                <div style={{ fontFamily:fB, fontSize:11, color:C.textSub, marginTop:2 }}>
                  {weekUpdates.length > 0 ? `Week ${Math.max(...weekUpdates.map(w=>w.week))} progress tracked` : "Week 1 baseline saved"}
                </div>
              </div>
            </div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              <button onClick={() => { setAnalysis(savedProfile); setPhase("results"); }}
                style={{ fontFamily:fB, fontSize:12, fontWeight:700, background:C.accent, color:"#06060e",
                  border:"none", borderRadius:8, padding:"9px 18px", cursor:"pointer" }}>
                View My Report →
              </button>
              <button onClick={() => setPhase("upload")}
                style={{ fontFamily:fB, fontSize:12, background:"none", color:C.textSub,
                  border:`1px solid ${C.border}`, borderRadius:8, padding:"9px 18px", cursor:"pointer" }}>
                New Analysis
              </button>
              <button onClick={clearProfile}
                style={{ fontFamily:fB, fontSize:12, background:"none", color:C.textDim,
                  border:"none", padding:"9px 8px", cursor:"pointer" }}>
                Clear
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // ─── UPLOAD ─────────────────────────────────────────────────────────────
  if (phase === "upload") return (
    <div style={{ minHeight:"100vh", background:C.bg, padding:"32px 16px 80px" }}>
      <style>{css}</style>
      <div style={{ maxWidth:700, margin:"0 auto" }}>
        <button onClick={()=>setPhase("landing")}
          style={{ fontFamily:fB, background:"none", border:"none", color:C.textSub, cursor:"pointer", fontSize:13, marginBottom:28, display:"flex", alignItems:"center", gap:6 }}>
          ← Back
        </button>
        <div style={{ marginBottom:32 }}>
          <div style={{ fontFamily:fM, fontSize:10, color:C.accentDim, letterSpacing:"0.2em", marginBottom:8 }}>BIOMAX · STEP 1 OF 2</div>
          <h2 style={{ fontFamily:fH, fontSize:28, color:C.text, marginBottom:6 }}>Upload Your Photos</h2>
          <p style={{ fontFamily:fB, fontSize:14, color:C.textSub, lineHeight:1.6 }}>
            Upload at least your frontal face photo. Adding all 4 photos unlocks a complete analysis. Each photo is validated before analysis.
          </p>
          {analysisError && (
            <div style={{ marginTop:14, padding:"12px 16px", background:"rgba(217,79,79,0.1)", border:`1px solid ${C.red}44`, borderRadius:8, fontFamily:fB, fontSize:13, color:C.red }}>
              {analysisError}
            </div>
          )}
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:32 }}>
          {photoConfig.map(cfg => (
            <UploadBox key={cfg.key} label={cfg.label} sublabel={cfg.sublabel} icon={cfg.icon} hint={cfg.hint}
              value={photos[cfg.key]} onChange={(f) => handlePhotoChange(cfg.key, f)}
              validating={!!validating[cfg.key]} valid={!!valid[cfg.key]} error={errors[cfg.key]}/>
          ))}
        </div>

        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:"16px 20px", marginBottom:28 }}>
          <div style={{ fontFamily:fB, fontSize:12, fontWeight:700, color:C.textSub, marginBottom:6, textTransform:"uppercase", letterSpacing:"0.07em" }}>
            📊 Validation Status
          </div>
          <div style={{ display:"flex", gap:16, flexWrap:"wrap" }}>
            {photoConfig.map(cfg => (
              <div key={cfg.key} style={{ display:"flex", alignItems:"center", gap:6 }}>
                <div style={{ width:8, height:8, borderRadius:"50%",
                  background: validating[cfg.key] ? C.accent : valid[cfg.key] ? C.green : errors[cfg.key] ? C.red : C.border,
                  animation: validating[cfg.key] ? "pulse 1s ease infinite" : "none" }}/>
                <span style={{ fontFamily:fM, fontSize:11, color: valid[cfg.key] ? C.green : errors[cfg.key] ? C.red : C.textDim }}>
                  {cfg.key.charAt(0).toUpperCase()+cfg.key.slice(1)}
                  {validating[cfg.key] ? " …" : valid[cfg.key] ? " ✓" : errors[cfg.key] ? " ✗" : ""}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display:"flex", justifyContent:"flex-end" }}>
          <Btn onClick={() => setPhase("goals")} disabled={!frontalValid || Object.values(validating).some(Boolean)}>
            Continue → Set Goals
          </Btn>
        </div>
      </div>
    </div>
  );

  // ─── GOALS ──────────────────────────────────────────────────────────────
  if (phase === "goals") return (
    <div style={{ minHeight:"100vh", background:C.bg, padding:"32px 16px 80px", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <style>{css}</style>
      <div style={{ maxWidth:560, width:"100%" }}>
        <button onClick={()=>setPhase("upload")}
          style={{ fontFamily:fB, background:"none", border:"none", color:C.textSub, cursor:"pointer", fontSize:13, marginBottom:28, display:"flex", alignItems:"center", gap:6 }}>
          ← Back
        </button>
        <div style={{ fontFamily:fM, fontSize:10, color:C.accentDim, letterSpacing:"0.2em", marginBottom:8 }}>STEP 2 OF 2</div>
        <h2 style={{ fontFamily:fH, fontSize:28, color:C.text, marginBottom:6 }}>Your Profile & Goals</h2>
        <p style={{ fontFamily:fB, fontSize:14, color:C.textSub, lineHeight:1.6, marginBottom:24 }}>
          Biometrics help calibrate body composition analysis. Goals let us target your plan precisely.
        </p>

        {/* Biometrics sliders */}
        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:"22px 24px", marginBottom:24 }}>
          <div style={{ fontFamily:fM, fontSize:10, color:C.accentDim, letterSpacing:"0.15em", marginBottom:20 }}>BIOMETRICS <span style={{color:C.textDim}}>· optional but improves accuracy</span></div>
          <style>{`
            .bio-slider { -webkit-appearance:none; appearance:none; width:100%; height:4px; border-radius:2px; outline:none; cursor:pointer; background: linear-gradient(to right, ${C.accent} 0%, ${C.accent} var(--pct,50%), #1e2238 var(--pct,50%), #1e2238 100%); }
            .bio-slider::-webkit-slider-thumb { -webkit-appearance:none; width:18px; height:18px; border-radius:50%; background:${C.accentBright}; border:2px solid ${C.accent}; box-shadow:0 0 8px ${C.accentGlow}; cursor:pointer; }
            .bio-slider::-moz-range-thumb { width:18px; height:18px; border-radius:50%; background:${C.accentBright}; border:2px solid ${C.accent}; box-shadow:0 0 8px ${C.accentGlow}; cursor:pointer; }
          `}</style>
          <div style={{ display:"flex", flexDirection:"column", gap:24 }}>

            {/* Age slider 16–70 */}
            {(() => {
              const ageMin=16, ageMax=70;
              const agePct = ((userInfo.age - ageMin)/(ageMax-ageMin)*100).toFixed(1);
              return (
                <div>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:10 }}>
                    <span style={{ fontFamily:fB, fontSize:12, fontWeight:700, color:C.textSub, textTransform:"uppercase", letterSpacing:"0.08em" }}>Age</span>
                    <span style={{ fontFamily:fH, fontSize:22, color:C.accent, fontWeight:600, lineHeight:1 }}>{userInfo.age}<span style={{ fontFamily:fB, fontSize:12, color:C.accentDim, marginLeft:4 }}>yrs</span></span>
                  </div>
                  <input type="range" className="bio-slider" min={ageMin} max={ageMax} value={userInfo.age}
                    style={{"--pct":`${agePct}%`}}
                    onChange={e => setUserInfo(u => ({...u, age: parseInt(e.target.value)}))}/>
                  <div style={{ display:"flex", justifyContent:"space-between", fontFamily:fM, fontSize:9, color:C.textDim, marginTop:4 }}>
                    <span>16</span><span>70</span>
                  </div>
                </div>
              );
            })()}

            {/* Height slider 152cm–198cm (5'0"–6'6") */}
            {(() => {
              const htMin=152, htMax=198;
              const htPct = ((userInfo.height - htMin)/(htMax-htMin)*100).toFixed(1);
              const totalIn = Math.round(userInfo.height / 2.54);
              const ft = Math.floor(totalIn/12), inch = totalIn%12;
              return (
                <div>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:10 }}>
                    <span style={{ fontFamily:fB, fontSize:12, fontWeight:700, color:C.textSub, textTransform:"uppercase", letterSpacing:"0.08em" }}>Height</span>
                    <div style={{ textAlign:"right" }}>
                      <span style={{ fontFamily:fH, fontSize:22, color:C.accent, fontWeight:600, lineHeight:1 }}>{userInfo.height}<span style={{ fontFamily:fB, fontSize:12, color:C.accentDim, marginLeft:4 }}>cm</span></span>
                      <span style={{ fontFamily:fM, fontSize:11, color:C.textSub, marginLeft:10 }}>{ft}'{inch}"</span>
                    </div>
                  </div>
                  <input type="range" className="bio-slider" min={htMin} max={htMax} value={userInfo.height}
                    style={{"--pct":`${htPct}%`}}
                    onChange={e => setUserInfo(u => ({...u, height: parseInt(e.target.value)}))}/>
                  <div style={{ display:"flex", justifyContent:"space-between", fontFamily:fM, fontSize:9, color:C.textDim, marginTop:4 }}>
                    <span>5'0"</span><span>6'6"</span>
                  </div>
                </div>
              );
            })()}

            {/* Weight slider 90–300 lbs */}
            {(() => {
              const wtMin=90, wtMax=300;
              const wtPct = ((userInfo.weight - wtMin)/(wtMax-wtMin)*100).toFixed(1);
              const kg = Math.round(userInfo.weight * 0.4536);
              return (
                <div>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:10 }}>
                    <span style={{ fontFamily:fB, fontSize:12, fontWeight:700, color:C.textSub, textTransform:"uppercase", letterSpacing:"0.08em" }}>Weight</span>
                    <div style={{ textAlign:"right" }}>
                      <span style={{ fontFamily:fH, fontSize:22, color:C.accent, fontWeight:600, lineHeight:1 }}>{userInfo.weight}<span style={{ fontFamily:fB, fontSize:12, color:C.accentDim, marginLeft:4 }}>lbs</span></span>
                      <span style={{ fontFamily:fM, fontSize:11, color:C.textSub, marginLeft:10 }}>{kg} kg</span>
                    </div>
                  </div>
                  <input type="range" className="bio-slider" min={wtMin} max={wtMax} value={userInfo.weight}
                    style={{"--pct":`${wtPct}%`}}
                    onChange={e => setUserInfo(u => ({...u, weight: parseInt(e.target.value)}))}/>
                  <div style={{ display:"flex", justifyContent:"space-between", fontFamily:fM, fontSize:9, color:C.textDim, marginTop:4 }}>
                    <span>90 lbs</span><span>300 lbs</span>
                  </div>
                </div>
              );
            })()}

          </div>
        </div>

        <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:14 }}>
          {["I'm losing hair", "Acne / breakouts", "Face puffiness", "Debloat / water retention", "Weak jaw", "Negative canthal tilt",
            "Poor posture", "Dark circles", "Skin texture", "Body composition", "Low cheekbones"].map(tag => {
            const active = selectedTags.includes(tag);
            return (
              <button key={tag} onClick={() => {
                if (active) {
                  setSelectedTags(s => s.filter(t => t !== tag));
                  setGoals(g => g.split(", ").filter(t => t !== tag).join(", "));
                } else {
                  setSelectedTags(s => [...s, tag]);
                  setGoals(g => g ? g + ", " + tag : tag);
                }
              }}
                style={{ fontFamily:fM, fontSize:10, cursor:"pointer", borderRadius:20,
                  padding:"6px 14px", transition:"all 0.18s", fontWeight: active ? 600 : 400,
                  color: active ? C.accent : C.textDim,
                  background: active ? "rgba(200,164,106,0.12)" : "transparent",
                  border: `1px solid ${active ? C.accentDim : C.border}` }}>
                + {tag}
              </button>
            );
          })}
        </div>

        <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:20 }}>
          {["Photo summary"].map(c => (
            <div key={c.key} style={{ display:"flex", alignItems:"center", marginLeft:0 }}>
            </div>
          ))}
          {photoConfig.filter(c => photos[c.key] && valid[c.key]).map(c => (
            <div key={c.key} style={{ borderRadius:8, overflow:"hidden", width:48, height:48, border:`2px solid ${C.accentDim}` }}>
              <img src={photos[c.key]} style={{ width:"100%", height:"100%", objectFit:"cover" }} alt={c.key}/>
            </div>
          ))}
          <div style={{ display:"flex", alignItems:"center", marginLeft:8 }}>
            <span style={{ fontFamily:fB, fontSize:12, color:C.textSub }}>
              {Object.values(valid).filter(Boolean).length} photo{Object.values(valid).filter(Boolean).length!==1?"s":""} validated
            </span>
          </div>
        </div>

        {/* Photo Type Selector */}
        <div style={{ marginBottom:20 }}>
          <div style={{ fontFamily:fB, fontSize:13, fontWeight:700, color:C.text, marginBottom:4 }}>Photo Type</div>

          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
            {[
              { val:"selfie", icon:"🤳", label:"Selfie", sub:"" },
              { val:"mirror", icon:"🪞", label:"Mirror Photo", sub:"" },
              { val:"professional", icon:"📷", label:"Pro / DSLR", sub:"" },
            ].map(({ val, icon, label, sub }) => {
              const active = photoContext === val;
              return (
                <button key={val} onClick={() => setPhotoContext(val)}
                  style={{ background: active ? C.accentGlow : C.surface,
                    border: `1px solid ${active ? C.accent : C.border}`,
                    borderRadius:10, padding:"12px 10px", cursor:"pointer",
                    textAlign:"center", transition:"all 0.18s",
                    boxShadow: active ? `0 0 16px ${C.accentGlow2}` : "none" }}>
                  <div style={{ fontSize:22, marginBottom:4 }}>{icon}</div>
                  <div style={{ fontFamily:fB, fontSize:12, fontWeight:700,
                    color: active ? C.accentBright : C.text, marginBottom:2 }}>{label}</div>


                </button>
              );
            })}
          </div>
        </div>

        <div style={{ marginBottom:10 }}>
          <div style={{ fontFamily:fB, fontSize:13, fontWeight:700, color:C.text, marginBottom:6 }}>Your Goals & Concerns</div>
          <textarea
            value={goals}
            onChange={e => setGoals(e.target.value)}
            placeholder="e.g. I'm losing hair on my temples, I have acne scarring on my cheeks, my face looks puffy especially in the morning, I want better jaw definition, my canthal tilt looks negative, I want to fix my forward head posture, I want to know about body composition…"
            style={{ width:"100%", minHeight:140, background:C.surface, border:`1px solid ${C.border}`,
              borderRadius:10, padding:"14px 16px", fontFamily:fB, fontSize:13, color:C.text,
              lineHeight:1.7, resize:"vertical", outline:"none" }}
            onFocus={e => e.target.style.borderColor = C.accentDim}
            onBlur={e => e.target.style.borderColor = C.border}
          />
          <div style={{ fontFamily:fM, fontSize:10, color:C.textDim, marginTop:4 }}>Optional but strongly recommended. Use quick-tags above or type freely.</div>
        </div>

        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:10, padding:"14px 18px", marginBottom:28 }}>
          <div style={{ fontFamily:fB, fontSize:12, color:C.textSub, lineHeight:1.65 }}>
            💡 <strong style={{ color:C.text }}>Mention specifically:</strong> hair thinning/loss, acne, puffiness, jaw weakness, canthal tilt, skin texture, dark circles, posture issues, body fat, symmetry concerns
          </div>
        </div>

        <Btn onClick={handleAnalyse}>⚡ Start Analysis</Btn>
      </div>
    </div>
  );

  // ─── ANALYSING ───────────────────────────────────────────────────────────
  if (phase === "analysing") return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", alignItems:"center", justifyContent:"center", padding:"40px 20px" }}>
      <style>{css}</style>
      <div style={{ textAlign:"center", maxWidth:480, width:"100%" }}>

        {/* Biohack loading ring */}
        <div style={{ marginBottom:36 }}>
          <BiohackRing progress={progress} size={240}/>
        </div>

        <h2 style={{ fontFamily:fH, fontSize:38, color:C.text, marginBottom:12 }}>
          Analysing
        </h2>

        {/* Animated label */}
        <div style={{ fontFamily:fM, fontSize:11, color:C.accent, letterSpacing:"0.12em",
          lineHeight:2, marginBottom:24, animation:"decode 0.5s ease" }}>
          {progressLabel}
        </div>

        {/* Terminal-style log */}
        <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:10,
          padding:"14px 18px", marginBottom:24, textAlign:"left", fontFamily:fM, fontSize:10 }}>
          {[
            { done: progress > 5,  text: "> Initialising facial geometry parser…" },
            { done: progress > 15, text: "> Extracting craniofacial landmarks…" },
            { done: progress > 30, text: "> Running golden ratio analysis…" },
            { done: progress > 45, text: "> Scoring 12 facial metrics…" },
            { done: progress > 55, text: "> Cross-referencing biohack protocols…" },
            { done: progress > 70, text: "> Generating personalised exercises…" },
            { done: progress > 80, text: "> Building supplement stack…" },
            { done: progress > 90, text: "> Compiling morning/evening routines…" },
            { done: progress >= 100, text: "> ANALYSIS COMPLETE" },
          ].map((l, i) => (
            <div key={i} style={{ color: l.done ? C.accentBright : C.textDim,
              marginBottom:3, transition:"color 0.3s",
              display: progress > i * 10 ? "block" : "none" }}>
              {l.done ? l.text : <><span style={{ animation:"blink 1s infinite" }}>▌</span>{l.text}</>}
            </div>
          ))}
        </div>

        <div style={{ display:"flex", gap:6, justifyContent:"center", marginTop:8, marginBottom:20 }}>
          {[0,1,2].map(i => <div key={i} style={{ width:6, height:6, borderRadius:"50%", background:C.accent,
            animation:`pulse 1.2s ease ${i*.25}s infinite`, opacity:0.8 }}/>)}
        </div>

        <LoadingTip/>

        {analysisError && (
          <div style={{ marginTop:16, padding:"18px 20px", background:"rgba(217,79,79,0.1)",
            border:`1px solid ${C.red}55`, borderRadius:12 }}>
            <div style={{ fontFamily:fM, fontSize:11, color:C.red, marginBottom:6, letterSpacing:"0.08em" }}>
              ⚠ ANALYSIS ERROR
            </div>
            <div style={{ fontFamily:fB, fontSize:12, color:"#e88", marginBottom:14, lineHeight:1.6, wordBreak:"break-word" }}>
              {analysisError.includes("API error 529") || analysisError.includes("overloaded")
                ? "Analysis servers are temporarily busy. Please wait a moment and retry."
                : analysisError.includes("parse") || analysisError.includes("JSON")
                ? "Response parsing failed — the API response was truncated or malformed. Retrying usually fixes this."
                : analysisError}
            </div>
            <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
              <button onClick={() => { setAnalysisError(null); handleAnalyse(); }}
                style={{ fontFamily:fB, fontSize:12, fontWeight:700, background:C.accent, color:"#06060e",
                  border:"none", borderRadius:8, padding:"10px 20px", cursor:"pointer" }}>
                ↺ Retry Analysis
              </button>
              <button onClick={() => { setAnalysisError(null); setPhase("goals"); }}
                style={{ fontFamily:fB, fontSize:12, background:"none", color:C.textSub,
                  border:`1px solid ${C.border}`, borderRadius:8, padding:"10px 20px", cursor:"pointer" }}>
                ← Edit Goals
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // ─── WEEK UPDATE UPLOAD ──────────────────────────────────────────────────
  if (weekPhase && !weekAnalysing) return (
    <div style={{ minHeight:"100vh", background:C.bg, padding:"32px 16px 80px", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <style>{css}</style>
      <div style={{ maxWidth:560, width:"100%" }}>
        <button onClick={() => { setWeekPhase(null); setPhase("results"); }}
          style={{ fontFamily:fB, background:"none", border:"none", color:C.textSub, cursor:"pointer", fontSize:13, marginBottom:28 }}>
          ← Back to Report
        </button>
        <div style={{ fontFamily:fM, fontSize:10, color:C.accentDim, letterSpacing:"0.2em", marginBottom:8 }}>
          PROGRESS CHECK — WEEK {weekPhase}
        </div>
        <h2 style={{ fontFamily:fH, fontSize:38, color:C.text, marginBottom:8 }}>
          Week {weekPhase} Update
        </h2>
        <p style={{ fontFamily:fB, fontSize:14, color:C.textSub, lineHeight:1.6, marginBottom:28 }}>
          Upload your photos to compare against your Week 1 baseline. Frontal is required — all others are optional but improve accuracy.
        </p>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:28 }}>
          {[
            { key:"frontal", label:"Frontal Face",  icon:"🧑", hint:"Same angle as Week 1 · Good light", required:true },
            { key:"profile", label:"Side Profile",  icon:"👤", hint:"Optional · Same angle as Week 1",  required:false },
            { key:"torso",   label:"Torso",          icon:"👕", hint:"Optional · Fitted clothing",        required:false },
            { key:"body",    label:"Full Body",       icon:"🏃", hint:"Optional · Head to feet",           required:false },
          ].map(cfg => {
            const hasPhoto = weekPhotos[cfg.key];
            return (
              <div key={cfg.key}
                style={{ background:C.card,
                  border:`2px dashed ${weekPhotoErrors[cfg.key] ? C.red : hasPhoto ? C.accentDim : C.border}`,
                  borderRadius:12, padding:"20px 16px", textAlign:"center", cursor:"pointer", position:"relative",
                  transition:"border-color 0.2s" }}
                onClick={() => document.getElementById("weekupload-"+cfg.key).click()}>
                {weekValidating[cfg.key] ? (
                  <div style={{ padding:"20px 0" }}>
                    <div style={{ fontFamily:fM, fontSize:10, color:C.accent, animation:"blink 1s infinite" }}>VALIDATING…</div>
                  </div>
                ) : weekPhotoErrors[cfg.key] ? (
                  <>
                    <div style={{ fontSize:24, marginBottom:6 }}>⚠️</div>
                    <div style={{ fontFamily:fB, fontSize:11, color:C.red, lineHeight:1.5, marginBottom:6 }}>{weekPhotoErrors[cfg.key]}</div>
                    <div style={{ fontFamily:fM, fontSize:9, color:C.textDim }}>Tap to retry</div>
                  </>
                ) : hasPhoto ? (
                  <img src={weekPhotos[cfg.key]} style={{ width:"100%", height:140, objectFit:"cover", borderRadius:8 }} alt={cfg.key}/>
                ) : (
                  <>
                    <div style={{ fontSize:24, marginBottom:6 }}>{cfg.icon}</div>
                    <div style={{ fontFamily:fB, fontSize:13, fontWeight:700, color:C.text, marginBottom:4 }}>{cfg.label}</div>
                    {cfg.required && <div style={{ fontFamily:fM, fontSize:9, color:C.red, marginBottom:4 }}>REQUIRED</div>}
                    <div style={{ fontFamily:fM, fontSize:10, color:C.textDim }}>{cfg.hint}</div>
                  </>
                )}
                <input id={"weekupload-"+cfg.key} type="file" accept="image/*" style={{ display:"none" }}
                  onChange={e => { const f=e.target.files[0]; if(f) handleWeekPhotoChange(cfg.key,f); e.target.value=""; }}/>
              </div>
            );
          })}
        </div>

        {weekError && (
          <div style={{ background:"rgba(217,79,79,0.1)", border:`1px solid ${C.red}55`, borderRadius:10,
            padding:"14px 18px", marginBottom:20, fontFamily:fB, fontSize:13, color:"#e88" }}>
            ⚠ {weekError}
          </div>
        )}

        <Btn onClick={() => runWeekAnalysis(weekPhase)} disabled={!weekPhotoFiles.frontal || Object.values(weekValidating).some(Boolean)}>
          ⚡ Analyse Week {weekPhase} Progress
        </Btn>
        <p style={{ fontFamily:fM, fontSize:10, color:C.textDim, marginTop:12, textAlign:"center" }}>
          Results are compared against your Week 1 baseline automatically
        </p>
      </div>
    </div>
  );

  // ─── WEEK ANALYSING ───────────────────────────────────────────────────────
  if (weekAnalysing) return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", alignItems:"center", justifyContent:"center", padding:"40px 20px" }}>
      <style>{css}</style>
      <div style={{ textAlign:"center", maxWidth:420, width:"100%" }}>
        <BiohackRing progress={weekProgress} size={200}/>
        <h2 style={{ fontFamily:fH, fontSize:26, color:C.text, marginTop:16, marginBottom:6 }}>
          Analysing Progress
        </h2>
        <div style={{ fontFamily:fM, fontSize:11, color:C.accent, letterSpacing:"0.12em", lineHeight:2, marginBottom:24 }}>
          Comparing Week {weekPhase} against your baseline…
        </div>
        <LoadingTip/>
      </div>
    </div>
  );



  // ─── RESULTS ─────────────────────────────────────────────────────────────
  if (phase === "results" && analysis) {
    const tabs = [
      { id:"face",       label:"🧑 Face",        free:true  },
      { id:"body",       label:"💪 Body",        free:true  },
      { id:"exercises",  label:"🏋️ Exercises",  free:false },
      { id:"techniques", label:"🤲 Techniques",  free:false },
      { id:"routines",   label:"🌅 Routines",   free:false },
      { id:"stack",      label:"💊 Stack",      free:false },
    ];

    const faceScoreKeys = [
      { key:"symmetry",            label:"Symmetry"            },
      { key:"canthalTilt",         label:"Canthal Tilt"        },
      { key:"goldenRatio",         label:"Golden Ratio"        },
      { key:"facialThirds",        label:"Facial Thirds"       },
      { key:"jawDefinition",       label:"Jaw Definition"      },
      { key:"cheekboneProminence", label:"Cheekbone Prominence"},
      { key:"eyeArea",             label:"Eye Area"            },
      { key:"noseHarmony",         label:"Nose Harmony"        },
      { key:"lipProportion",       label:"Lip Proportion"      },
      { key:"skinQuality",         label:"Skin Quality"        },
      { key:"neckJaw",             label:"Neck & Submental"    },
    ];

    const bodyScoreKeys = [
      { key:"overallComposition", label:"Overall Composition" },
      { key:"posture",            label:"Posture"             },
      { key:"shoulderToWaist",    label:"Shoulder-to-Waist"  },
      { key:"muscleDevelopment",  label:"Muscle Development"  },
      { key:"legDevelopment",     label:"Leg Development"     },
    ];

    

    // Normalize AI-generated category to our known set
    const normalizeCategory = (cat) => {
      if (!cat) return "Craniofacial";
      const c = cat.toLowerCase().trim();
      if (c.includes("eye") || c.includes("canthal") || c.includes("orbital")) return "Eyes";
      if (c.includes("posture") || c.includes("structure") || c.includes("cervical")) return "Posture";
      if (c.includes("fascia") || c.includes("soft tissue") || c.includes("tissue")) return "Fascia";
      if (c.includes("asymm")) return "Asymmetry";
      if (c.includes("craniosacral") || c.includes("cranial")) return "Craniosacral";
      if (c.includes("skin") || c.includes("acne") || c.includes("scar")) return "Skin";
      if (c.includes("hair") || c.includes("scalp")) return "Hair";
      if (c.includes("body") || c.includes("full")) return "Body";
      if (c.includes("recover") || c.includes("rest")) return "Recovery";
      if (c.includes("jaw") || c.includes("craniofacial") || c.includes("mewing") || c.includes("palate")) return "Craniofacial";
      return "Craniofacial";
    };
    const exerciseCategories = ["All", "Craniofacial", "Asymmetry", "Craniosacral", "Cervical", "Fascia", "Posture", "Skin", "Eyes", "Hair", "Body", "Recovery"];
    const filteredExercises = (analysis.exercises || []).filter(ex =>
      exerciseFilter === "All" || normalizeCategory(ex.category) === exerciseFilter
    );

    return (
      <div style={{ minHeight:"100vh", background:C.bg, fontFamily:fB }}>
        <style>{css}</style>
        <div style={{ maxWidth:480, margin:"0 auto", padding:"16px 12px 80px" }}>

          {/* Header */}
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16, paddingTop:8, gap:8, flexWrap:"wrap" }}>
            <button onClick={resetApp}
              style={{ background:"none", border:`1px solid ${C.border}`, borderRadius:8, padding:"8px 14px",
                color:C.textSub, cursor:"pointer", fontFamily:fB, fontSize:12 }}>
              ← Home
            </button>
            <div style={{ fontFamily:fM, fontSize:10, color:C.accentDim, letterSpacing:"0.15em" }}>BIOMAX · ANALYSIS REPORT</div>
            <div style={{ display:"flex", gap:8, alignItems:"center" }}>
              {saveStatus === "saved" && (
                <span style={{ fontFamily:fM, fontSize:10, color:C.green }}>✓ Saved</span>
              )}
              {saveStatus === "saving" && (
                <span style={{ fontFamily:fM, fontSize:10, color:C.accent }}>Saving…</span>
              )}
              <button onClick={() => saveProfileToStorage(analysis, weekUpdates, userInfo, goals)}
                style={{ background:C.accentGlow, border:`1px solid ${C.accentDim}`, borderRadius:8, padding:"8px 14px",
                  color:C.accent, cursor:"pointer", fontFamily:fB, fontSize:12, fontWeight:700 }}>
                💾 Save
              </button>
            </div>
          </div>

          {/* Week Progress Timeline */}
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:"16px 20px", marginBottom:24 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
              <div style={{ fontFamily:fM, fontSize:9, color:C.accentDim, letterSpacing:"0.18em" }}>PROGRESS TRACKER</div>
              {!isPaid && (
                <button onClick={() => setIsPaid(true)}
                  style={{ fontFamily:fM, fontSize:9, background:"linear-gradient(135deg,#C8A46A,#FFD700)",
                    border:"none", borderRadius:6, padding:"4px 10px", cursor:"pointer",
                    color:"#06060e", fontWeight:700, letterSpacing:"0.06em" }}>
                  🔒 UNLOCK WEEKS 2–4
                </button>
              )}
            </div>
            <div style={{ display:"flex", gap:0, position:"relative" }}>
              {[
                { n:1, label:"Week 1", sub:"Baseline" },
                { n:2, label:"Week 2", sub:"+7 days" },
                { n:3, label:"Week 3", sub:"+14 days" },
                { n:4, label:"Week 4", sub:"+21 days" },
              ].map((w, i, arr) => {
                const weekLocked = w.n > 1 && !isPaid;
                const done = w.n === 1 || weekUpdates.some(u => u.week === w.n);
                const upd = weekUpdates.find(u => u.week === w.n);
                const active = !weekLocked && !done && (w.n === 2 || weekUpdates.some(u => u.week === w.n - 1));
                return (
                  <div key={w.n} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", position:"relative",
                    opacity: weekLocked ? 0.45 : 1, transition:"opacity 0.2s" }}>
                    {i < arr.length-1 && (
                      <div style={{ position:"absolute", top:16, left:"50%", width:"100%", height:2,
                        background: done && !weekLocked ? C.accent : C.border, zIndex:0, transition:"background 0.3s" }}/>
                    )}
                    <div style={{ width:32, height:32, borderRadius:"50%", zIndex:1,
                      background: weekLocked ? C.border : done ? `linear-gradient(135deg,${C.accent},${C.accentBright})` : active ? C.surface : C.border,
                      border: done && !weekLocked ? "none" : `2px solid ${active ? C.accentDim : C.border}`,
                      display:"flex", alignItems:"center", justifyContent:"center",
                      fontFamily:fM, fontSize:11, fontWeight:700,
                      color: weekLocked ? C.textDim : done ? "#06060e" : active ? C.accent : C.textDim,
                      cursor: weekLocked ? "not-allowed" : active ? "pointer" : "default",
                      boxShadow: active ? `0 0 16px ${C.accentGlow}` : "none",
                      transition:"all 0.3s" }}
                      onClick={() => { if (active && !weekLocked) setWeekPhase(w.n); }}>
                      {weekLocked ? "🔒" : done ? "✓" : w.n}
                    </div>
                    <div style={{ fontFamily:fB, fontSize:10, fontWeight:700, color:done&&!weekLocked?C.accent:active?C.textSub:C.textDim, marginTop:6, textAlign:"center" }}>{w.label}</div>
                    <div style={{ fontFamily:fM, fontSize:9, color:C.textDim, textAlign:"center" }}>{upd ? `Score: ${upd.currentScore}` : w.sub}</div>
                    {upd && !weekLocked && (
                      <div style={{ fontFamily:fM, fontSize:9, color: upd.scoreDelta >= 0 ? C.green : C.red, textAlign:"center" }}>
                        {upd.scoreDelta >= 0 ? "+" : ""}{upd.scoreDelta}
                      </div>
                    )}
                    {active && !weekLocked && (
                      <button onClick={() => setWeekPhase(w.n)}
                        style={{ marginTop:4, fontFamily:fM, fontSize:9, background:C.accentGlow, border:`1px solid ${C.accentDim}`,
                          borderRadius:6, padding:"3px 8px", color:C.accent, cursor:"pointer" }}>
                        Update →
                      </button>
                    )}
                    {weekLocked && (
                      <button onClick={() => setIsPaid(true)}
                        style={{ marginTop:4, fontFamily:fM, fontSize:9, background:"rgba(200,164,106,0.1)", border:`1px solid ${C.accentDim}`,
                          borderRadius:6, padding:"3px 8px", color:C.accent, cursor:"pointer" }}>
                        Unlock
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Metric Progression Chart — premium only */}
          {weekUpdates.length >= 1 && isPaid && (
            <MetricChart savedProfile={savedProfile} weekUpdates={weekUpdates} />
          )}

          {/* Current week update result card — premium only */}
          {weekUpdates.length > 0 && isPaid && (() => {
            const latestWeek = Math.max(...weekUpdates.map(u => u.week));
            const upd = weekUpdates.find(u => u.week === latestWeek);
            if (!upd) return null;
            return (
              <div style={{ marginBottom:20 }}>
                <div style={{ background:C.card, border:`1px solid ${upd.scoreDelta >= 0 ? C.green+"44" : C.red+"44"}`,
                  borderRadius:12, padding:"16px 20px", marginBottom:12, animation:"fadeUp .4s ease both" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:10 }}>
                    <div style={{ fontFamily:fM, fontSize:10, color:C.accentDim, letterSpacing:"0.12em" }}>WEEK {upd.week} UPDATE</div>
                    <div style={{ flex:1, height:1, background:C.border }}/>
                    <div style={{ fontFamily:fM, fontSize:13, fontWeight:700,
                      color: upd.scoreDelta >= 0 ? C.green : C.red }}>
                      {upd.scoreDelta >= 0 ? "▲" : "▼"} {Math.abs(upd.scoreDelta)} pts → {upd.currentScore}/100
                    </div>
                  </div>
                  {upd.photoFrontal && (
                    <div style={{ borderRadius:10, overflow:"hidden", marginBottom:12, maxHeight:220, textAlign:"center" }}>
                      <img src={upd.photoFrontal} style={{ maxHeight:220, maxWidth:"100%", objectFit:"cover", borderRadius:10, border:`1px solid ${C.border}` }} alt={`Week ${upd.week} photo`}/>
                    </div>
                  )}

                  <p style={{ fontFamily:fB, fontSize:13, color:C.textSub, lineHeight:1.7, marginBottom:10 }}>{upd.progressSummary}</p>
                  {upd.improvements?.length > 0 && (
                    <div style={{ marginBottom:8 }}>
                      <div style={{ fontFamily:fM, fontSize:9, color:C.green, letterSpacing:"0.1em", marginBottom:6 }}>✓ IMPROVEMENTS</div>
                      {upd.improvements.map((imp,i) => (
                        <div key={i} style={{ fontFamily:fB, fontSize:12, color:C.text, marginBottom:3 }}>· {imp}</div>
                      ))}
                    </div>
                  )}
                  {upd.nextWeekFocus?.length > 0 && (
                    <div>
                      <div style={{ fontFamily:fM, fontSize:9, color:C.accent, letterSpacing:"0.1em", marginBottom:6 }}>→ NEXT 7 DAYS</div>
                      {upd.nextWeekFocus.map((f,i) => (
                        <div key={i} style={{ fontFamily:fB, fontSize:12, color:C.text, marginBottom:3 }}>· {f}</div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Hero overall score */}
          <div style={{ background:`linear-gradient(135deg,${C.card},${C.surface})`,
            border:`1px solid ${C.accentDim}`, borderRadius:20, padding:"36px 28px",
            textAlign:"center", marginBottom:24, position:"relative", overflow:"hidden",
            boxShadow:`0 0 60px ${C.accentGlow}`, animation:"fadeUp .6s ease both" }}>
            <div style={{ position:"absolute", inset:0, background:`radial-gradient(ellipse 80% 50% at 50% 0%, ${C.accentGlow2}, transparent)`, pointerEvents:"none" }}/>
            <div style={{ position:"relative", zIndex:1 }}>

              {/* Dual ring row — current + potential */}
              {(() => {
                // Always show the most recent week's score, fall back to baseline
                const _lw = [...weekUpdates].sort((a,b) => b.week - a.week)[0];
                const displayScore = _lw?.currentScore ?? analysis.overallScore;
                const baselineScore = analysis.overallScore;
                const scoreGain = displayScore - baselineScore;
                const rawPot = Math.min(100,
                  displayScore + (analysis.exercises||[]).reduce((s,ex) => s + (ex.scorePotential||0), 0)
                );
                const maxSpr = displayScore >= 80 ? 15 : displayScore >= 70 ? 20 : displayScore >= 60 ? 25 : 30;
                const totalPotential = Math.min(rawPot, displayScore + maxSpr);
                const potColor = scoreColor(totalPotential);
                return (
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:24, flexWrap:"wrap" }}>
                    {/* Current score ring */}
                    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:6 }}>
                      <div style={{ fontFamily:fM, fontSize:9, color:C.textDim, letterSpacing:"0.18em", marginBottom:4 }}>
                        {_lw ? `WEEK ${_lw.week} SCORE` : "CURRENT"}
                      </div>
                      <AnimatedRing score={displayScore} size={160} hero={true}/>
                      <div style={{ fontFamily:fH, fontSize:"clamp(16px,4vw,24px)", color:scoreColor(displayScore),
                        fontWeight:300, letterSpacing:"0.06em", fontStyle:"italic",
                        textShadow:`0 0 30px ${scoreColor(displayScore)}44` }}>
                        {_lw ? scoreLabel(displayScore) : (analysis.smvLabel || scoreLabel(displayScore))}
                      </div>
                      {scoreGain > 0 && (
                        <div style={{ fontFamily:fM, fontSize:10, color:C.green, letterSpacing:"0.1em" }}>
                          ▲ +{scoreGain} pts since baseline
                        </div>
                      )}
                    </div>

                    {/* Arrow */}
                    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
                      <div style={{ fontFamily:fM, fontSize:22, color:C.accentDim }}>›</div>
                      <div style={{ fontFamily:fM, fontSize:8, color:C.accentDim, letterSpacing:"0.1em", textAlign:"center", maxWidth:56 }}>
                        FOLLOW<br/>ROUTINE
                      </div>
                    </div>

                    {/* Potential score ring */}
                    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:6 }}>
                      <div style={{ fontFamily:fM, fontSize:9, color:"rgba(255,215,0,0.6)", letterSpacing:"0.18em", marginBottom:4 }}>POTENTIAL</div>
                      <AnimatedRing score={totalPotential} size={160} hero={true}/>
                      <div style={{ fontFamily:fH, fontSize:"clamp(16px,4vw,24px)", color:potColor,
                        fontWeight:300, letterSpacing:"0.06em", fontStyle:"italic",
                        textShadow:`0 0 30px ${potColor}44` }}>
                        {scoreLabel(totalPotential)}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Badges row */}
              <BadgesRow analysis={analysis} weekUpdates={weekUpdates}/>

              <p style={{ fontFamily:fB, fontSize:13, color:C.textSub, marginTop:12, lineHeight:1.7, maxWidth:480, margin:"12px auto 0" }}>
                {analysis.summary}
              </p>

              {/* Photo thumbs */}
              <div style={{ display:"flex", gap:8, justifyContent:"center", marginTop:20, flexWrap:"wrap" }}>
                {photoConfig.filter(c=>photos[c.key]&&valid[c.key]).map(c=>(
                  <div key={c.key} style={{ borderRadius:8, overflow:"hidden", width:48, height:48, border:`2px solid ${C.accentDim}` }}>
                    <img src={photos[c.key]} style={{ width:"100%", height:"100%", objectFit:"cover" }} alt={c.key}/>
                  </div>
                ))}
              </div>
            </div>
          </div>



          {/* Score grid — top 5 */}
          {(() => {
            const _lgw = [...weekUpdates].sort((a,b) => b.week - a.week)[0];
            const _gridScores = _lgw?.faceScores ?? analysis.faceScores;
            return (
              <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:6, marginBottom:14 }}>
                {faceScoreKeys.slice(0,5).map(m => (
                  <div key={m.key} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:10, padding:"12px 6px", textAlign:"center" }}>
                    <AnimatedRing score={_gridScores?.[m.key] ?? 50} size={60}/>
                    <div style={{ fontFamily:fB, fontSize:9, color:C.textSub, marginTop:5, textTransform:"uppercase", letterSpacing:"0.05em" }}>{m.label}</div>
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Tabs */}
          <div style={{ display:"flex", gap:2, marginBottom:20, background:C.surface, borderRadius:12, padding:3 }}>
            {tabs.map(t=>{
              const locked = !t.free && !isPaid;
              return (
                <button key={t.id} onClick={()=>setActiveTab(t.id)}
                  style={{ flex:1, minWidth:0, fontFamily:fB, fontSize:10, fontWeight:600, padding:"7px 2px",
                    borderRadius:9, border:"none", cursor:"pointer", whiteSpace:"nowrap",
                    textAlign:"center", overflow:"hidden", textOverflow:"ellipsis",
                    background:activeTab===t.id?C.card:"none",
                    color:activeTab===t.id ? (locked ? "#FFD700" : C.accent) : (locked ? C.textDim : C.textSub),
                    boxShadow:activeTab===t.id?`0 0 10px ${C.accentGlow}`:"none", transition:"all .2s",
                    opacity: locked ? 0.75 : 1 }}>
                  {locked ? "🔒 " : ""}{t.label}
                </button>
              );
            })}
          </div>

          {/* ── TAB: FACE ── */}
          {activeTab === "face" && (
            <div style={{ animation:"fadeUp .4s ease both" }}>
              <div style={sec}>
                <h3 style={{ fontFamily:fH, fontSize:20, color:C.text, marginBottom:14 }}>Facial Metrics</h3>
                {(() => {
                  const _lfW = [...weekUpdates].sort((a,b) => b.week - a.week)[0];
                  const _fSc = _lfW?.faceScores ?? analysis.faceScores;
                  const _fOb = _lfW?.faceObservations ?? analysis.faceObservations;
                  return faceScoreKeys.map(m => (
                    <Bar key={m.key} label={m.label} score={_fSc?.[m.key]??50}
                      note={_fOb?.[
                        m.key === "noseHarmony" ? "nose" :
                        m.key === "lipProportion" ? "lips" :
                        m.key === "cheekboneProminence" ? "cheekbones" :
                        m.key === "skinQuality" ? "skin" :
                        m.key === "neckJaw" ? "profile" : m.key
                      ]}/>
                  ));
                })()}
              </div>
              {analysis.faceObservations?.profile && (
                <div style={sec}>
                  <h3 style={{ fontFamily:fH, fontSize:20, color:C.text, marginBottom:12 }}>👤 Side Profile Assessment</h3>
                  <p style={{ fontFamily:fB, fontSize:13, color:C.textSub, lineHeight:1.75 }}>{analysis.faceObservations.profile}</p>
                </div>
              )}
            </div>
          )}

          {/* ── TAB: BODY ── */}
          {activeTab === "body" && (
            <div style={{ animation:"fadeUp .4s ease both" }}>
              <div style={sec}>
                <h3 style={{ fontFamily:fH, fontSize:20, color:C.text, marginBottom:14 }}>Body Metrics</h3>
                {bodyScoreKeys.map(m => (
                  <Bar key={m.key} label={m.label} score={analysis.bodyScores?.[m.key]??50}
                    note={analysis.bodyObservations?.[
                      m.key === "overallComposition" ? "composition" :
                      m.key === "shoulderToWaist" ? "frame" :
                      m.key === "muscleDevelopment" ? "muscularity" :
                      m.key === "legDevelopment" ? "legs" : m.key
                    ]}/>
                ))}
              </div>
              <div style={sec}>
                <h3 style={{ fontFamily:fH, fontSize:20, color:C.text, marginBottom:14 }}>📊 Body Observations</h3>
                {Object.entries(analysis.bodyObservations || {}).map(([k,v])=>(
                  <div key={k} style={{ marginBottom:16, paddingBottom:16, borderBottom:`1px solid ${C.border}` }}>
                    <div style={{ fontFamily:fB, fontSize:12, fontWeight:700, color:C.accent,
                      textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:6 }}>
                      {k.replace(/([A-Z])/g,' $1').trim()}
                    </div>
                    <p style={{ fontFamily:fB, fontSize:13, color:C.textSub, lineHeight:1.7 }}>{v}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── TAB: EXERCISES ── */}
          {activeTab === "exercises" && (!isPaid ? <PaywallOverlay onUnlock={() => setIsPaid(true)} heading="Personalised Exercise Library" subheading={`${(analysis.exercises||[]).length} exercises precision-targeted to your specific concerns`} /> : (
            <div style={{ animation:"fadeUp .4s ease both" }}>
              {/* Daily reset check + StreakBanner */}
              {(() => {
                const allEx = analysis.exercises || [];
                // Run daily reset if needed (new day)
                if (needsDailyReset()) resetDailyFlags(allEx);
                const doneCount = allEx.filter(ex => {
                  try { return localStorage.getItem(`biomax_done_${(ex.title||"").replace(/\s+/g,"_").toLowerCase()}`) === "1"; } catch { return false; }
                }).length;
                // Record streak if all done today
                if (doneCount >= allEx.length && allEx.length > 0) recordStreakDay();
                return <StreakBanner exercises={allEx} doneCount={doneCount} />;
              })()}
              <div style={{ ...sec, marginBottom:16 }}>
                <h3 style={{ fontFamily:fH, fontSize:20, color:C.text, marginBottom:4 }}>Personalised Exercise Library</h3>
                <p style={{ fontFamily:fB, fontSize:13, color:C.textSub, marginBottom:16 }}>
                  {(analysis.exercises || []).length} exercises precision-targeted to your specific concerns. Each chosen for a reason.
                </p>
                {/* Category filter */}
                <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                  {exerciseCategories.map(cat => {
                    const catColors2 = { All:C.accent, Craniofacial:C.blue, Asymmetry:"#FF6EE7", Craniosacral:"#B066FF", Cervical:"#FF8C66", Fascia:C.purple, Posture:C.green, Skin:C.accent, Eyes:"#7FBAFF", Hair:C.gold, Body:C.cyan, Recovery:"#5FE8B0" };
                    const cc = catColors2[cat] || C.accent;
                    const active = exerciseFilter === cat;
                    return (
                      <button key={cat} onClick={() => setExerciseFilter(cat)}
                        style={{ fontFamily:fM, fontSize:10, padding:"5px 12px", borderRadius:20,
                          border:`1px solid ${active ? cc : C.border}`,
                          background: active ? `${cc}22` : "none",
                          color: active ? cc : C.textSub, cursor:"pointer", transition:"all 0.15s" }}>
                        {cat}
                      </button>
                    );
                  })}
                </div>
              </div>
              {filteredExercises.length === 0 && (
                <div style={{ ...sec, textAlign:"center", color:C.textSub, fontFamily:fB, fontSize:13 }}>
                  No exercises in this category.
                </div>
              )}
              {filteredExercises.map((ex, i) => <ExerciseCard key={i} ex={ex} index={i}/>)}

              {/* ── Bodywork & Manual Protocols ── */}
              {(analysis.protocols || []).filter(p => { const t=((p.title||"")+(p.how||"")+(p.why||"")).toLowerCase(); const terms=["supplement","capsule","tablet","pill","ingest","take daily","zinc","magnesium","vitamin d","vitamin c","biotin","collagen","peptide","niacinamide","retinol","spironolactone","minoxidil","finasteride","ketoconazole","saw palmetto","rosemary oil","ashwagandha","creatine","serum","moisturizer","moisturiser","sunscreen","spf","toner","cleanser","exfoliant","cream","lotion","gel","ointment","balm","tretinoin","adapalene","salicylic","hyaluronic","azelaic","shampoo","conditioner","hair oil","dermaroll","dermaroller","led mask","gua sha tool","jade roller","ice globe","cryo globe","cryo wand","face massager","facial steamer","microcurrent device","laser device","purchase","buy","iherb"]; return !terms.some(k => t.includes(k)); }).length > 0 && (
                <div style={{ ...sec, marginBottom:16, marginTop:8, border:`1px solid rgba(0,255,136,0.2)`,
                  background:`linear-gradient(135deg,rgba(0,255,136,0.04),${C.card})` }}>
                  <div style={{ fontFamily:fM, fontSize:9, color:C.green, letterSpacing:"0.16em", marginBottom:4 }}>BODYWORK PROTOCOLS</div>
                  <h3 style={{ fontFamily:fH, fontSize:22, color:C.text, marginBottom:6 }}>Targeted Protocols</h3>
                  <p style={{ fontFamily:fB, fontSize:12, color:C.textSub, marginBottom:14 }}>Technique-based protocols requiring no products — body-only work.</p>
                  {(analysis.protocols || []).filter(p => { const t=((p.title||"")+(p.how||"")+(p.why||"")).toLowerCase(); const terms=["supplement","capsule","tablet","pill","ingest","take daily","zinc","magnesium","vitamin d","vitamin c","biotin","collagen","peptide","niacinamide","retinol","spironolactone","minoxidil","finasteride","ketoconazole","saw palmetto","rosemary oil","ashwagandha","creatine","serum","moisturizer","moisturiser","sunscreen","spf","toner","cleanser","exfoliant","cream","lotion","gel","ointment","balm","tretinoin","adapalene","salicylic","hyaluronic","azelaic","shampoo","conditioner","hair oil","dermaroll","dermaroller","led mask","gua sha tool","jade roller","ice globe","cryo globe","cryo wand","face massager","facial steamer","microcurrent device","laser device","purchase","buy","iherb"]; return !terms.some(k => t.includes(k)); }).map((p,i) => <ProtocolCard key={i} p={p}/>)}
                </div>
              )}

              {/* Asymmetry + cranial daily habits card */}
              <div style={{ background:`linear-gradient(135deg,rgba(176,102,255,0.07),rgba(255,110,231,0.06),rgba(127,186,255,0.06))`,
                border:`1px solid rgba(176,102,255,0.3)`, borderRadius:14, padding:"18px 20px", marginTop:8 }}>
                <div style={{ fontFamily:fM, fontSize:9, color:"#B066FF", letterSpacing:"0.18em", marginBottom:10 }}>
                  ⚠ ASYMMETRY + CRANIAL TENSION — DAILY HABITS THAT MATTER AS MUCH AS EXERCISES
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                  {[
                    { avoid:"🚫 Chewing only on one side", fix:"Chew bilaterally — unilateral masseter loading drives gonial + zygomatic asymmetry" },
                    { avoid:"🚫 Sleeping on the same side every night", fix:"Alternate or go supine — unilateral pillow pressure causes periosteal remodeling over time" },
                    { avoid:"🚫 Head resting on one hand", fix:"Keep head centered — habitual lateral loading shifts the condylar resting position" },
                    { avoid:"🚫 Forward head / looking down at phone", fix:"Raise to eye level — each 2.5cm of anterior head translation doubles cervical load and drags the facial skeleton forward" },
                    { avoid:"🚫 Breathing through the mouth at rest", fix:"Nasal breathing maintains negative intraoral pressure that supports the palate and maxillary arch" },
                    { avoid:"🚫 Jaw clenching or bruxism under stress", fix:"Conscious jaw drop + tongue-to-palate rest position — reduces hyperactive pterygoid and masseter tone that compresses the TMJ" },
                  ].map((h,i) => (
                    <div key={i} style={{ background:"rgba(0,0,0,0.25)", borderRadius:8, padding:"10px 12px" }}>
                      <div style={{ fontFamily:fB, fontSize:11, color:"#FF9090", marginBottom:4 }}>{h.avoid}</div>
                      <div style={{ fontFamily:fB, fontSize:11, color:"#7FBAFF", lineHeight:1.5 }}>✓ {h.fix}</div>
                    </div>
                  ))}
                </div>
                <div style={{ fontFamily:fB, fontSize:11, color:C.textSub, marginTop:12, lineHeight:1.7,
                  borderTop:`1px solid rgba(176,102,255,0.2)`, paddingTop:12 }}>
                  <span style={{ color:"#B066FF" }}>Key insight:</span> Facial asymmetry is rarely a face problem. The three real anatomical drivers are <span style={{ color:"#FF6EE7" }}>C1–C2 cervical rotation</span>, <span style={{ color:"#FF8C66" }}>unilateral masseter/temporalis dominance</span>, and <span style={{ color:"#7FBAFF" }}>SCM tension + anterior head posture</span>. Cranial fascial compression compounds this by restricting the maxillary and palatine sutures. Exercises activate the weaker side. Habits stop the dominant side from undoing the work.
                </div>
              </div>
            </div>
          ))}


          {/* ── TAB: TECHNIQUES ── */}
          {activeTab === "techniques" && (!isPaid ? <PaywallOverlay onUnlock={() => setIsPaid(true)} heading="Manual Techniques" subheading="Hands-on craniosacral & fascial release techniques from Mindful Movement" icon="🤲" /> : (
            <div style={{ animation:"fadeUp .4s ease both" }}>
              <div style={{ ...sec, marginBottom:16, background:`linear-gradient(135deg,rgba(232,200,122,0.06),${C.card})`,
                border:`1px solid rgba(232,200,122,0.25)` }}>
                <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:8 }}>
                  <div style={{ width:40, height:40, borderRadius:10, background:"rgba(232,200,122,0.15)",
                    border:"1px solid rgba(232,200,122,0.3)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20 }}>🤲</div>
                  <div>
                    <div style={{ fontFamily:fM, fontSize:9, color:"#E8C87A", letterSpacing:"0.16em", marginBottom:2 }}>MANUAL TECHNIQUES</div>
                    <h3 style={{ fontFamily:fH, fontSize:24, color:C.text, margin:0 }}>Mindful Movement</h3>
                  </div>
                </div>
                <p style={{ fontFamily:fB, fontSize:13, color:C.textSub, lineHeight:1.65, marginBottom:0 }}>
                  Hands-on craniosacral and fascial release techniques. Each one targets a specific structural concern.
                  <span style={{ color:"#7FBAFF", fontWeight:600 }}> Blue terms</span> are anatomical — tap any to see the plain English.
                </p>
              </div>
              <FeaturedTechniques />
            </div>
          ))}

          {/* ── TAB: ROUTINES ── */}
          {activeTab === "routines" && (!isPaid ? <PaywallOverlay onUnlock={() => setIsPaid(true)} heading="Morning &amp; Evening Routines" icon="🌅" subheading="Your personalised morning and evening step-by-step protocols" /> : (
            <div style={{ animation:"fadeUp .4s ease both" }}>
              <div style={{ ...sec, marginBottom:18 }}>
                <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:18 }}>
                  <span style={{ fontSize:22 }}>🌅</span>
                  <h3 style={{ fontFamily:fH, fontSize:24, color:C.text }}>Morning Routine</h3>
                </div>
                {(analysis.morningRoutine?.steps || []).map((s,i) => <RoutineStep key={i} step={s} index={i}/>)}
              </div>
              <div style={sec}>
                <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:18 }}>
                  <span style={{ fontSize:22 }}>🌙</span>
                  <h3 style={{ fontFamily:fH, fontSize:24, color:C.text }}>Evening Routine</h3>
                </div>
                {(analysis.eveningRoutine?.steps || []).map((s,i) => <RoutineStep key={i} step={s} index={i}/>)}
              </div>
            </div>
          ))}

          {/* ── TAB: STACK ── */}
          {activeTab === "stack" && (!isPaid ? <PaywallOverlay onUnlock={() => setIsPaid(true)} heading="💊 Personalised Supplement Stack" subheading="Tailored to your detected concerns and goals. Essential items shown first." /> : (
            <div style={{ animation:"fadeUp .4s ease both" }}>
              <div style={sec}>
                <h3 style={{ fontFamily:fH, fontSize:20, color:C.text, marginBottom:4 }}>💊 Personalised Supplement Stack</h3>
                <p style={{ fontFamily:fB, fontSize:13, color:C.textSub, marginBottom:16 }}>
                  Tailored to your detected concerns and goals. Essential items are shown first.
                </p>
                {/* Product-based protocols */}
                {(() => {
                  const productProtos = (analysis.protocols || []).filter(p => { const t=((p.title||"")+(p.how||"")+(p.why||"")).toLowerCase(); const terms=["supplement","capsule","tablet","pill","ingest","take daily","zinc","magnesium","vitamin d","vitamin c","biotin","collagen","peptide","niacinamide","retinol","spironolactone","minoxidil","finasteride","ketoconazole","saw palmetto","rosemary oil","ashwagandha","creatine","serum","moisturizer","moisturiser","sunscreen","spf","toner","cleanser","exfoliant","cream","lotion","gel","ointment","balm","tretinoin","adapalene","salicylic","hyaluronic","azelaic","shampoo","conditioner","hair oil","dermaroll","dermaroller","led mask","gua sha tool","jade roller","ice globe","cryo globe","cryo wand","face massager","facial steamer","microcurrent device","laser device","purchase","buy","iherb"]; return terms.some(k => t.includes(k)); });
                  if (!productProtos.length) return null;
                  return (
                    <div style={{ marginBottom:24 }}>
                      <div style={{ fontFamily:fM, fontSize:9, color:C.accent, letterSpacing:"0.14em", marginBottom:10 }}>── PRODUCT PROTOCOLS ──</div>
                      {productProtos.map((p,i) => <ProtocolCard key={i} p={p}/>)}
                    </div>
                  );
                })()}
                {/* Essentials first */}
                {["Essential","Recommended","Optional"].map(tier => {
                  const items = (analysis.supplementStack || []).filter(s => s.priority === tier);
                  if (!items.length) return null;
                  return (
                    <div key={tier} style={{ marginBottom:20 }}>
                      <div style={{ fontFamily:fM, fontSize:10, color:
                        tier==="Essential"?C.red:tier==="Recommended"?C.accent:C.textSub,
                        letterSpacing:"0.12em", marginBottom:10, textTransform:"uppercase" }}>
                        ── {tier} ──
                      </div>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr", gap:10 }}>
                        {items.map((s, i) => <SupplementCard key={i} s={s}/>)}
                      </div>
                    </div>
                  );
                })}
                {/* Any without priority */}
                {(() => {
                  const items = (analysis.supplementStack || []).filter(s => !s.priority);
                  if (!items.length) return null;
                  return (
                    <div style={{ display:"grid", gridTemplateColumns:"1fr", gap:10 }}>
                      {items.map((s, i) => <SupplementCard key={i} s={s}/>)}
                    </div>
                  );
                })()}
              </div>
            </div>
          ))}

          <div style={{ marginTop:28, padding:"14px 18px", background:C.surface, borderRadius:10, border:`1px solid ${C.border}` }}>
            <p style={{ fontFamily:fB, fontSize:11, color:C.textDim, lineHeight:1.7, textAlign:"center" }}>
              For informational purposes only. Consult qualified medical professionals before starting any supplement, medication, or health protocol. Natural methods require consistent effort over months. Always purchase supplements from reputable Canadian retailers.
            </p>
          </div>

          {/* ── COMP CARD — week 1 baseline + week 4 final only ── */}
          {analysis && (weekUpdates.length === 0 || weekUpdates.some(u => u.week === 4)) && (
            <ModelCompCard
              analysis={analysis}
              weekUpdates={weekUpdates}
              userInfo={userInfo}
              frontalPhoto={photos.frontal}
              w4FrontalPhoto={weekUpdates.find(u => u.week === 4)?.photoFrontal || null}
            />
          )}
        </div>
      </div>
    );
  }

  return null;
}