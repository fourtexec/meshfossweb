// «Жидкое стекло» на шейдерах Liquid Glass Studio.
//
// Шейдеры — порт из https://github.com/iyinchao/liquid-glass-studio (MIT,
// © 2024 Charles Yin; см. assets/vendor/liquid-glass-studio/LICENSE):
//   vertex.glsl, fragment-bg-hblur/vblur.glsl — без изменений по сути;
//   lib/sdf.glsl — roundedRectSDF с суперэллипсными углами и smin;
//   lib/color.glsl — sRGB ↔ LCH для френеля и блика;
//   fragment-main.glsl, финальный шаг (STEP 9): преломление по Снеллиусу,
//   дисперсия, тонировка, френель и блик — те же формулы и параметры.
// Отличия от Studio: фон — анимированные обои приложения (fragment-bg),
// а вместо одной фигуры и курсора — до MAX_SHAPES стеклянных элементов
// страницы ([data-studio]), слитых через smin, как фигуры в Studio.
//
// Холст лежит под DOM: фон + стекло рисуются здесь, а текст элементов — поверх.

const MAX_SHAPES = 24;
const BLUR_RADIUS = 14; // в пикселях буфера размытия (половинное разрешение)

const VERTEX = `#version 300 es
in vec4 a_position;
out vec2 v_uv;
void main() {
  v_uv = (a_position.xy + 1.0) * 0.5;
  gl_Position = a_position;
}`;

// Обои: градиент, плавающие пятна и сетка — то же, что CSS-фон приложения.
// Тени фигур — как в fragment-bg.glsl Studio (shadowExpand / shadowFactor).
const FRAGMENT_BG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform vec2 u_resolution;
uniform float u_dpr;
uniform float u_time;
uniform vec3 u_bg;
uniform vec3 u_bg2;
uniform vec3 u_blob[4];
uniform float u_blobAlpha;
uniform vec3 u_gridColor;
uniform int u_shapeCount;
uniform vec4 u_shapes[${MAX_SHAPES}];
uniform float u_radii[${MAX_SHAPES}];
uniform float u_shadowExpand;
uniform float u_shadowFactor;

float roundedRectPx(vec2 p, vec2 size, float r) {
  vec2 d = abs(p) - size * 0.5 + r;
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - r;
}

void main() {
  vec2 css = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y) / u_dpr;
  vec2 view = u_resolution / u_dpr;
  float vmax = max(view.x, view.y);
  vec3 col = mix(u_bg2, u_bg, smoothstep(0.0, 0.75, length((css / view - vec2(0.1, 0.0)) * vec2(1.0, 0.9))));
  float t = u_time;
  vec2 c[4];
  c[0] = view * vec2(0.08, 0.04) + vec2(sin(t * 0.21), cos(t * 0.17)) * vmax * 0.08;
  c[1] = view * vec2(1.02, 0.52) + vec2(cos(t * 0.19), sin(t * 0.23)) * vmax * 0.09;
  c[2] = view * vec2(0.35, 1.05) + vec2(sin(t * 0.16 + 1.0), cos(t * 0.2)) * vmax * 0.08;
  c[3] = view * vec2(0.62, 0.22) + vec2(cos(t * 0.27 + 2.0), sin(t * 0.18)) * vmax * 0.06;
  float r[4] = float[4](0.36, 0.38, 0.4, 0.22);
  for (int i = 0; i < 4; i++) {
    float d = length(css - c[i]) / (vmax * r[i]);
    col = mix(col, u_blob[i], u_blobAlpha * exp(-d * d * 2.2) * (i == 3 ? 0.75 : 1.0));
  }
  // сетка 44 px, гаснущая к краям
  vec2 g = abs(fract(css / 44.0 + 0.5) - 0.5) * 44.0;
  float line = 1.0 - smoothstep(0.0, 1.0, min(g.x, g.y));
  float fade = 1.0 - smoothstep(0.25, 0.8, length((css / view - vec2(0.5, 0.3)) * vec2(1.0, 0.8)));
  col = mix(col, u_gridColor, line * 0.06 * fade);

  // тени стеклянных фигур (Studio: exp(-|sdf| / shadowExpand))
  float shadow = 0.0;
  for (int i = 0; i < ${MAX_SHAPES}; i++) {
    if (i >= u_shapeCount) break;
    vec4 s = u_shapes[i];
    float d = roundedRectPx(css - s.xy - vec2(0.0, 4.0), s.zw, u_radii[i]);
    shadow = max(shadow, exp(-1.0 / u_shadowExpand * abs(d)) * 0.6 * u_shadowFactor * step(0.0, d));
  }
  fragColor = vec4(col - vec3(shadow), 1.0);
}`;

const blurShader = (axis) => `#version 300 es
precision highp float;
#define MAX_BLUR_RADIUS (${BLUR_RADIUS})
in vec2 v_uv;
uniform sampler2D u_prevPassTexture;
uniform vec2 u_resolution;
uniform int u_blurRadius;
uniform float u_blurWeights[MAX_BLUR_RADIUS + 1];
out vec4 fragColor;
void main() {
  vec2 texelSize = 1.0 / u_resolution;
  vec4 color = texture(u_prevPassTexture, v_uv) * u_blurWeights[0];
  for (int i = 1; i <= u_blurRadius; ++i) {
    float w = u_blurWeights[i];
    vec2 offset = vec2(float(i)) * texelSize;
    color += texture(u_prevPassTexture, v_uv + ${axis === 'h' ? 'vec2(offset.x, 0.0)' : 'vec2(0.0, offset.y)'}) * w;
    color += texture(u_prevPassTexture, v_uv - ${axis === 'h' ? 'vec2(offset.x, 0.0)' : 'vec2(0.0, offset.y)'}) * w;
  }
  fragColor = color;
}`;

// lib/color.glsl из Studio (LCH-стек Rachmanin0xFF/GLSL-Color-Functions).
const COLOR_LIB = `
const vec3 WHITE = vec3(0.95045592705, 1.0, 1.08905775076);
const mat3 RGB_TO_XYZ_M = mat3(0.4124, 0.3576, 0.1805, 0.2126, 0.7152, 0.0722, 0.0193, 0.1192, 0.9505);
const mat3 XYZ_TO_RGB_M = mat3(3.2406255, -1.537208, -0.4986286, -0.9689307, 1.8757561, 0.0415175, 0.0557101, -0.2040211, 1.0569959);
float UNCOMPAND_SRGB(float a) { return a > 0.04045 ? pow((a + 0.055) / 1.055, 2.4) : a / 12.92; }
float COMPAND_RGB(float a) { return a <= 0.0031308 ? 12.92 * a : 1.055 * pow(a, 0.41666666666) - 0.055; }
vec3 SRGB_TO_RGB(vec3 s) { return vec3(UNCOMPAND_SRGB(s.x), UNCOMPAND_SRGB(s.y), UNCOMPAND_SRGB(s.z)); }
vec3 RGB_TO_SRGB(vec3 r) { return vec3(COMPAND_RGB(r.x), COMPAND_RGB(r.y), COMPAND_RGB(r.z)); }
float XYZ_TO_LAB_F(float x) { return x > 0.00885645167 ? pow(x, 0.333333333) : 7.78703703704 * x + 0.13793103448; }
vec3 SRGB_TO_LCH(vec3 srgb) {
  vec3 xyz = SRGB_TO_RGB(srgb) * RGB_TO_XYZ_M;
  vec3 s = xyz / WHITE;
  s = vec3(XYZ_TO_LAB_F(s.x), XYZ_TO_LAB_F(s.y), XYZ_TO_LAB_F(s.z));
  vec3 lab = vec3(116.0 * s.y - 16.0, 500.0 * (s.x - s.y), 200.0 * (s.y - s.z));
  return vec3(lab.x, sqrt(dot(lab.yz, lab.yz)), atan(lab.z, lab.y) * 57.2957795131);
}
float LAB_TO_XYZ_F(float x) { return x > 0.206897 ? x * x * x : 0.12841854934 * (x - 0.137931034); }
vec3 LCH_TO_SRGB(vec3 lch) {
  vec3 lab = vec3(lch.x, lch.y * cos(lch.z * 0.01745329251), lch.y * sin(lch.z * 0.01745329251));
  float w = (lab.x + 16.0) / 116.0;
  vec3 xyz = WHITE * vec3(LAB_TO_XYZ_F(w + lab.y / 500.0), LAB_TO_XYZ_F(w), LAB_TO_XYZ_F(w - lab.z / 200.0));
  return RGB_TO_SRGB(xyz * XYZ_TO_RGB_M);
}`;

const FRAGMENT_MAIN = `#version 300 es
precision highp float;
#define PI (3.14159265359)
const float N_R = 1.0 - 0.02;
const float N_G = 1.0;
const float N_B = 1.0 + 0.02;

in vec2 v_uv;
uniform sampler2D u_blurredBg;
uniform sampler2D u_bg;
uniform vec2 u_resolution;
uniform float u_dpr;
uniform int u_shapeCount;
uniform vec4 u_shapes[${MAX_SHAPES}];
uniform float u_radii[${MAX_SHAPES}];
uniform float u_mergeRate;
uniform float u_shapeRoundness;
uniform vec4 u_tint;
uniform float u_refThickness;
uniform float u_refDistance;
uniform float u_refFactor;
uniform float u_refDispersion;
uniform float u_refFresnelRange;
uniform float u_refFresnelFactor;
uniform float u_refFresnelHardness;
uniform float u_glareRange;
uniform float u_glareConvergence;
uniform float u_glareOppositeFactor;
uniform float u_glareFactor;
uniform float u_glareHardness;
uniform float u_glareAngle;
uniform int u_blurEdge;
out vec4 fragColor;

${COLOR_LIB}

float safeAsin(float x) { return asin(clamp(x, -1.0, 1.0)); }

float superellipseCornerSDF(vec2 p, float r, float n) {
  p = abs(p);
  float v = pow(pow(p.x, n) + pow(p.y, n), 1.0 / n);
  return v - r;
}

// roundedRectSDF из lib/sdf.glsl Studio; размеры — в device px, результат
// нормирован на высоту холста (единицы Studio).
float roundedRectSDF(vec2 p, vec2 center, float width, float height, float cr, float n) {
  p -= center;
  vec2 d = abs(p) - vec2(width, height) * 0.5;
  float dist;
  if (d.x > -cr && d.y > -cr) {
    vec2 cornerCenter = sign(p) * (vec2(width, height) * 0.5 - vec2(cr));
    dist = superellipseCornerSDF(p - cornerCenter, cr, n);
  } else {
    dist = min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
  }
  return dist / u_resolution.y;
}

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float mainSDF(vec2 p) {
  float d = 1.0;
  for (int i = 0; i < ${MAX_SHAPES}; i++) {
    if (i >= u_shapeCount) break;
    vec4 s = u_shapes[i];
    vec2 c = vec2(s.x, u_resolution.y / u_dpr - s.y) * u_dpr;
    float r = min(u_radii[i], min(s.z, s.w) * 0.5) * u_dpr;
    float di = roundedRectSDF(p, c, s.z * u_dpr, s.w * u_dpr, r, u_shapeRoundness);
    d = i == 0 ? di : smin(d, di, u_mergeRate);
  }
  return d;
}

vec2 getNormal(vec2 p) {
  // В Studio шаг берётся из dFdx(gl_FragCoord) — он всегда 1 px; константа
  // позволяет считать нормаль только внутри фигур (вне однородного потока).
  vec2 h = vec2(1.0);
  vec2 grad = vec2(
    mainSDF(p + vec2(h.x, 0.0)) - mainSDF(p - vec2(h.x, 0.0)),
    mainSDF(p + vec2(0.0, h.y)) - mainSDF(p - vec2(0.0, h.y))
  ) / (2.0 * h);
  return grad * 1.414213562 * 1000.0;
}

float vec2ToAngle(vec2 v) {
  float angle = atan(v.y, v.x);
  if (angle < 0.0) angle += 2.0 * PI;
  return angle;
}

vec4 getTextureDispersion(sampler2D tex1, sampler2D tex2, float mixRate, vec2 offset, float factor) {
  vec4 pixel = vec4(1.0);
  float bgR = texture(tex1, v_uv + offset * (1.0 - (N_R - 1.0) * factor)).r;
  float bgG = texture(tex1, v_uv + offset * (1.0 - (N_G - 1.0) * factor)).g;
  float bgB = texture(tex1, v_uv + offset * (1.0 - (N_B - 1.0) * factor)).b;
  float blurR = texture(tex2, v_uv + offset * (1.0 - (N_R - 1.0) * factor)).r;
  float blurG = texture(tex2, v_uv + offset * (1.0 - (N_G - 1.0) * factor)).g;
  float blurB = texture(tex2, v_uv + offset * (1.0 - (N_B - 1.0) * factor)).b;
  pixel.r = mix(bgR, blurR, mixRate);
  pixel.g = mix(bgG, blurG, mixRate);
  pixel.b = mix(bgB, blurB, mixRate);
  return pixel;
}

void main() {
  vec2 u_resolution1x = u_resolution.xy / u_dpr;
  float merged = mainSDF(gl_FragCoord.xy);
  vec4 outColor;

  // ---- Studio, fragment-main.glsl, STEP 9 ----
  if (merged < 0.005) {
    vec2 normal = getNormal(gl_FragCoord.xy);
    float nmerged = -1.0 * (merged * u_resolution1x.y);
    float x_R_ratio = 1.0 - nmerged / u_refThickness;
    float thetaI = safeAsin(pow(x_R_ratio, 2.0));
    float thetaT = safeAsin(1.0 / u_refFactor * sin(thetaI));
    float edgeFactor = -1.0 * tan(thetaT - thetaI);
    if (nmerged >= u_refThickness) {
      edgeFactor = 0.0;
    }

    if (edgeFactor <= 0.0) {
      outColor = texture(u_blurredBg, v_uv);
      outColor = mix(outColor, vec4(u_tint.r, u_tint.g, u_tint.b, 1.0), u_tint.a * 0.8);
    } else {
      float edgeH = nmerged / u_refThickness;
      vec4 blurredPixel = getTextureDispersion(
        u_bg,
        u_blurredBg,
        u_blurEdge > 0 ? 1.0 : edgeH,
        -normal * edgeFactor * u_refDistance * u_dpr *
          vec2(u_resolution.y / (u_resolution1x.x * u_dpr), 1.0),
        u_refDispersion
      );

      outColor = mix(blurredPixel, vec4(u_tint.r, u_tint.g, u_tint.b, 1.0), u_tint.a * 0.8);

      float fresnelFactor = clamp(
        pow(1.0 + merged * u_resolution1x.y / 1500.0 * pow(500.0 / u_refFresnelRange, 2.0) + u_refFresnelHardness, 5.0),
        0.0, 1.0
      );
      vec3 fresnelTintLCH = SRGB_TO_LCH(mix(vec3(1.0), vec3(u_tint.r, u_tint.g, u_tint.b), u_tint.a * 0.5));
      fresnelTintLCH.x += 20.0 * fresnelFactor * u_refFresnelFactor;
      fresnelTintLCH.x = clamp(fresnelTintLCH.x, 0.0, 100.0);
      outColor = mix(outColor, vec4(LCH_TO_SRGB(fresnelTintLCH), 1.0), fresnelFactor * u_refFresnelFactor * 0.7 * length(normal));

      float glareGeoFactor = clamp(
        pow(1.0 + merged * u_resolution1x.y / 1500.0 * pow(500.0 / u_glareRange, 2.0) + u_glareHardness, 5.0),
        0.0, 1.0
      );
      float glareAngle = (vec2ToAngle(normalize(normal)) - PI / 4.0 + u_glareAngle) * 2.0;
      int glareFarside = 0;
      if (glareAngle > PI * (2.0 - 0.5) && glareAngle < PI * (4.0 - 0.5) || glareAngle < PI * (0.0 - 0.5)) {
        glareFarside = 1;
      }
      float glareAngleFactor =
        (0.5 + sin(glareAngle) * 0.5) * (glareFarside == 1 ? 1.2 * u_glareOppositeFactor : 1.2) * u_glareFactor;
      glareAngleFactor = clamp(pow(glareAngleFactor, 0.1 + u_glareConvergence * 2.0), 0.0, 1.0);

      vec3 glareTintLCH = SRGB_TO_LCH(mix(blurredPixel.rgb, vec3(u_tint.r, u_tint.g, u_tint.b), u_tint.a * 0.5));
      glareTintLCH.x += 150.0 * glareAngleFactor * glareGeoFactor;
      glareTintLCH.y += 30.0 * glareAngleFactor * glareGeoFactor;
      glareTintLCH.x = clamp(glareTintLCH.x, 0.0, 120.0);
      outColor = mix(outColor, vec4(LCH_TO_SRGB(glareTintLCH), 1.0), glareAngleFactor * glareGeoFactor * length(normal));
    }
  } else {
    outColor = texture(u_bg, v_uv);
  }
  outColor = mix(outColor, texture(u_bg, v_uv), smoothstep(-0.001, 0.001, merged));
  fragColor = outColor;
}`;

// Параметры — значения по умолчанию из Controls.tsx Studio, кроме подогнанных
// под элементы интерфейса (Studio рассчитан на фигуру ~200 px): тоньше кромка,
// меньше смещение и более круглые углы (суперэллипс n=2.4 вместо 5), иначе на
// карточках высотой 60–80 px кромка занимает почти всю фигуру.
const PARAMS = {
  refThickness: 14,
  refDistance: 0.03,
  refFactor: 1.4,
  refDispersion: 7,
  refFresnelRange: 30,
  refFresnelHardness: 0.2,
  refFresnelFactor: 0.2,
  glareRange: 30,
  glareHardness: 0.2,
  glareFactor: 0.9,
  glareConvergence: 0.5,
  glareOppositeFactor: 0.8,
  glareAngle: (-45 * Math.PI) / 180,
  shapeRoundness: 2.4,
  shadowExpand: 25,
  shadowFactor: 0.15,
};

function gaussianKernel(radius) {
  // computeGaussianKernelByRadius из Studio (src/utils/index.ts)
  const sigma = radius / 3.0;
  const kernel = [];
  let sum = 0;
  for (let i = 0; i <= radius; i++) {
    const w = Math.exp((-0.5 * (i * i)) / (sigma * sigma));
    kernel.push(w);
    sum += i === 0 ? w : w * 2;
  }
  return kernel.map((w) => w / sum);
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`shader: ${log}`);
  }
  return shader;
}

function program(gl, fragment) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fragment));
  gl.bindAttribLocation(p, 0, 'a_position');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`link: ${gl.getProgramInfoLog(p)}`);
  const uniforms = new Map();
  const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(p, i);
    uniforms.set(info.name.replace(/\[0\]$/, ''), gl.getUniformLocation(p, info.name));
  }
  return { p, uniforms };
}

function target(gl, w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return { tex, fb, w, h };
}

function cssColor(name) {
  const probe = document.createElement('span');
  probe.style.color = `var(${name})`;
  probe.style.display = 'none';
  document.body.append(probe);
  const m = getComputedStyle(probe).color.match(/[\d.]+/g) || ['0', '0', '0'];
  probe.remove();
  return [Number(m[0]) / 255, Number(m[1]) / 255, Number(m[2]) / 255, m[3] === undefined ? 1 : Number(m[3])];
}

class StudioGlass {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'studio-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    const gl = this.canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: 'low-power' });
    if (!gl) throw new Error('webgl2 unavailable');
    this.gl = gl;
    this.bg = program(gl, FRAGMENT_BG);
    this.hblur = program(gl, blurShader('h'));
    this.vblur = program(gl, blurShader('v'));
    this.main = program(gl, FRAGMENT_MAIN);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.weights = gaussianKernel(BLUR_RADIUS);
    this.targets = null;
    this.running = false;
    this.start = performance.now();
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    this.readTheme();
    this.onResize = () => this.resize();
    this.onVisibility = () => { if (document.visibilityState === 'visible') this.frame(); };
    this.themeObserver = new MutationObserver(() => this.readTheme());
    this.schemeQuery = matchMedia('(prefers-color-scheme: dark)');
    this.onScheme = () => this.readTheme();
  }

  readTheme() {
    const pick = (n) => cssColor(n).slice(0, 3);
    this.theme = {
      bg: pick('--bg'),
      bg2: pick('--bg-2'),
      blobs: ['--blob-1', '--blob-2', '--blob-3', '--blob-4'].flatMap(pick),
      grid: pick('--text'),
      tint: cssColor('--studio-tint'),
    };
    this.frame();
  }

  attach() {
    document.body.prepend(this.canvas);
    document.documentElement.classList.add('studio');
    addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    this.schemeQuery.addEventListener('change', this.onScheme);
    this.resize();
    this.running = true;
    this.loop();
  }

  detach() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.themeObserver.disconnect();
    this.schemeQuery.removeEventListener('change', this.onScheme);
    this.canvas.remove();
    document.documentElement.classList.remove('studio');
  }

  resize() {
    const gl = this.gl;
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(innerWidth * this.dpr));
    const h = Math.max(1, Math.round(innerHeight * this.dpr));
    if (this.canvas.width === w && this.canvas.height === h && this.targets) return;
    this.canvas.width = w;
    this.canvas.height = h;
    const bw = Math.max(1, w >> 1);
    const bh = Math.max(1, h >> 1);
    if (this.targets) Object.values(this.targets).forEach((t) => { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); });
    this.targets = { bg: target(gl, w, h), half: target(gl, bw, bh), blurA: target(gl, bw, bh), blurB: target(gl, bw, bh) };
    this.frame();
  }

  /** Стеклянные элементы на экране → прямоугольники в CSS px. */
  collectShapes() {
    const shapes = [];
    const radii = [];
    const vh = innerHeight;
    const clip = document.querySelector('.content');
    const topbar = document.querySelector('.topbar')?.getBoundingClientRect();
    const tabbar = document.querySelector('.tabbar')?.getBoundingClientRect();
    const clipTop = topbar ? topbar.bottom + 8 : -Infinity;
    const clipBottom = tabbar ? tabbar.top - 10 : Infinity;
    for (const el of document.querySelectorAll('[data-studio]')) {
      if (shapes.length / 4 >= MAX_SHAPES) break;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || r.bottom < -40 || r.top > vh + 40) continue;
      if (el.closest('dialog')) continue; // диалоги в верхнем слое — CSS-стекло
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
      // Карточки прокручиваемого содержимого обрезаем по видимому окну:
      // стекло «уходит» под верхнюю и нижнюю панели, а не сливается с ними.
      let top = r.top;
      let bottom = r.bottom;
      if (clip && clip.contains(el)) {
        top = Math.max(top, clipTop);
        bottom = Math.min(bottom, clipBottom);
        if (bottom - top < 6) continue;
      }
      // радиус с учётом transform: scale()
      const scale = el.offsetHeight ? r.height / el.offsetHeight : 1;
      shapes.push(r.left + r.width / 2, (top + bottom) / 2, r.width, bottom - top);
      radii.push((parseFloat(style.borderTopLeftRadius) || 0) * scale);
    }
    return { shapes, radii, count: radii.length };
  }

  set(prog, name, ...v) {
    const gl = this.gl;
    const loc = prog.uniforms.get(name);
    if (loc === undefined || loc === null) return;
    const value = v[0];
    if (Array.isArray(value) || value instanceof Float32Array) {
      if (name === 'u_shapes') gl.uniform4fv(loc, value);
      else if (name === 'u_blob') gl.uniform3fv(loc, value);
      else gl.uniform1fv(loc, value);
    } else if (v.length === 1) {
      if (Number.isInteger(value) && /Count|Radius|Edge/.test(name)) gl.uniform1i(loc, value);
      else gl.uniform1f(loc, value);
    } else if (v.length === 2) gl.uniform2f(loc, ...v);
    else if (v.length === 3) gl.uniform3f(loc, ...v);
    else gl.uniform4f(loc, ...v);
  }

  pass(prog, out, setup) {
    const gl = this.gl;
    gl.useProgram(prog.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, out ? out.fb : null);
    gl.viewport(0, 0, out ? out.w : this.canvas.width, out ? out.h : this.canvas.height);
    setup();
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  texture(prog, name, unit, tex) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(prog.uniforms.get(name), unit);
  }

  frame() {
    if (!this.targets || document.visibilityState === 'hidden') return;
    const gl = this.gl;
    const { bg, half, blurA, blurB } = this.targets;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const time = this.reducedMotion.matches ? 0 : (performance.now() - this.start) / 1000;
    const { shapes, radii, count } = this.collectShapes();
    const shapesArr = new Float32Array(MAX_SHAPES * 4);
    shapesArr.set(shapes);
    const radiiArr = new Float32Array(MAX_SHAPES);
    radiiArr.set(radii);
    const th = this.theme;

    // 1. фон (обои + тени фигур)
    this.pass(this.bg, bg, () => {
      this.set(this.bg, 'u_resolution', w, h);
      this.set(this.bg, 'u_dpr', this.dpr);
      this.set(this.bg, 'u_time', time);
      this.set(this.bg, 'u_bg', ...th.bg);
      this.set(this.bg, 'u_bg2', ...th.bg2);
      this.set(this.bg, 'u_blob', th.blobs);
      this.set(this.bg, 'u_blobAlpha', 0.62);
      this.set(this.bg, 'u_gridColor', ...th.grid);
      gl.uniform1i(this.bg.uniforms.get('u_shapeCount'), count);
      this.set(this.bg, 'u_shapes', shapesArr);
      this.set(this.bg, 'u_radii', radiiArr);
      this.set(this.bg, 'u_shadowExpand', PARAMS.shadowExpand);
      this.set(this.bg, 'u_shadowFactor', PARAMS.shadowFactor);
    });
    // 2. уменьшение и два прохода гауссова размытия (fragment-bg-hblur/vblur)
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, bg.fb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, half.fb);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, half.w, half.h, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    const blur = (prog, src, out) => this.pass(prog, out, () => {
      this.texture(prog, 'u_prevPassTexture', 0, src.tex);
      this.set(prog, 'u_resolution', out.w, out.h);
      gl.uniform1i(prog.uniforms.get('u_blurRadius'), BLUR_RADIUS);
      this.set(prog, 'u_blurWeights', this.weights);
    });
    blur(this.hblur, half, blurA);
    blur(this.vblur, blurA, blurB);
    blur(this.hblur, blurB, blurA);
    blur(this.vblur, blurA, blurB);
    // 3. стекло (fragment-main, STEP 9) прямо на экран
    this.pass(this.main, null, () => {
      const m = this.main;
      this.texture(m, 'u_bg', 0, bg.tex);
      this.texture(m, 'u_blurredBg', 1, blurB.tex);
      this.set(m, 'u_resolution', w, h);
      this.set(m, 'u_dpr', this.dpr);
      gl.uniform1i(m.uniforms.get('u_shapeCount'), count);
      this.set(m, 'u_shapes', shapesArr);
      this.set(m, 'u_radii', radiiArr);
      // smin в единицах Studio (доля высоты холста): ~18 CSS px
      this.set(m, 'u_mergeRate', (18 * this.dpr) / h);
      this.set(m, 'u_shapeRoundness', PARAMS.shapeRoundness);
      this.set(m, 'u_tint', ...th.tint);
      for (const key of ['refThickness', 'refDistance', 'refFactor', 'refDispersion', 'refFresnelRange',
        'refFresnelFactor', 'refFresnelHardness', 'glareRange', 'glareConvergence', 'glareOppositeFactor',
        'glareFactor', 'glareHardness', 'glareAngle']) {
        this.set(m, `u_${key}`, PARAMS[key]);
      }
      gl.uniform1i(m.uniforms.get('u_blurEdge'), 1);
    });
  }

  loop() {
    if (!this.running) return;
    this.frame();
    this.raf = requestAnimationFrame(() => this.loop());
  }
}

let instance = null;

export function studioSupported() {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

/** Включить/выключить рендер Liquid Glass Studio. Возвращает, включён ли он. */
export function setStudioEnabled(on) {
  if (on && !instance) {
    try {
      instance = new StudioGlass();
      instance.attach();
    } catch (e) {
      console.warn('Liquid Glass Studio renderer:', e);
      instance = null;
    }
  } else if (!on && instance) {
    instance.detach();
    instance = null;
  }
  return !!instance;
}
