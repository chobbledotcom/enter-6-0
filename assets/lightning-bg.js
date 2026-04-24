(() => {
  const canvas = document.getElementById("lightning-bg");
  if (!canvas) return;

  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  const gl =
    canvas.getContext("webgl2", {
      antialias: false,
      alpha: true,
      premultipliedAlpha: false,
      powerPreference: "low-power",
    }) ||
    canvas.getContext("webgl", {
      antialias: false,
      alpha: true,
      premultipliedAlpha: false,
      powerPreference: "low-power",
    });

  if (!gl) return;

  const isWebGL2 = typeof WebGL2RenderingContext !== "undefined" &&
    gl instanceof WebGL2RenderingContext;

  const vsSource = isWebGL2
    ? `#version 300 es
in vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }`
    : `attribute vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }`;

  const fsBody = `
    vec2 res = u_resolution;
    vec2 uv = (gl_FragCoord.xy - 0.5 * res) / res.y;
    float t = u_time;

    vec3 col = vec3(0.0);

    // Three bolts, different speeds, seeds and tint colours
    col += bolt(uv, t,           0.0, 1.00, vec3(0.15, 1.00, 0.65)) * 1.00;
    col += bolt(uv, t * 0.78 + 7.3, 2.1, 0.75, vec3(0.00, 0.85, 1.00)) * 0.85;
    col += bolt(uv, t * 1.14 + 3.7, 4.8, 1.25, vec3(0.35, 1.00, 0.25)) * 0.70;

    // Rare sharp flash — brightens every few seconds
    float flashPhase = fract(t * 0.17);
    float flash = smoothstep(0.85, 1.0, flashPhase) *
                  (1.0 - smoothstep(0.97, 1.0, flashPhase));
    col += flash * vec3(0.3, 1.0, 0.6) * 0.25;

    // Soft horizon haze near the bolts
    float haze = fbm(uv * 2.5 + vec2(t * 0.08, 0.0));
    col += haze * vec3(0.0, 0.05, 0.03);

    // Radial falloff — darker at edges
    float vig = 1.0 - 0.35 * dot(uv, uv);
    col *= vig;

    // Soft tonemap so highlights hold their colour
    col = col / (1.0 + col);
    col = pow(col, vec3(0.9));

    outColor = vec4(col, 1.0);
  `;

  const fsShared = `
    precision highp float;

    float hash21(vec2 p) {
      p = fract(p * vec2(233.34, 851.73));
      p += dot(p, p + 23.45);
      return fract(p.x * p.y);
    }

    float vnoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      float a = hash21(i);
      float b = hash21(i + vec2(1.0, 0.0));
      float c = hash21(i + vec2(0.0, 1.0));
      float d = hash21(i + vec2(1.0, 1.0));
      return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    }

    float fbm(vec2 p) {
      float v = 0.0;
      float a = 0.5;
      for (int i = 0; i < 4; i++) {
        v += a * vnoise(p);
        p = p * 2.03 + vec2(17.1, 31.7);
        a *= 0.5;
      }
      return v;
    }

    // Single swooping lightning arc
    // uv    : screen coord (-aspect..aspect, -0.5..0.5)
    // t     : time
    // seed  : per-bolt phase offset
    // speed : horizontal drift speed
    // tint  : base colour
    vec3 bolt(vec2 uv, float t, float seed, float speed, vec3 tint) {
      // Domain warp for swoosh
      vec2 q = uv;
      q.x += t * speed * 0.12 + seed;
      float w1 = fbm(q * 1.2 + seed * 3.1);
      float w2 = fbm(q * 2.8 - t * 0.3 + seed);
      vec2 warped = uv + vec2(0.0, (w1 - 0.5) * 0.55 + (w2 - 0.5) * 0.18);

      // Gentle sine curves stacked to feel electric
      float y = warped.y;
      y += 0.18 * sin(uv.x * 2.4 + t * 0.9 + seed);
      y += 0.09 * sin(uv.x * 5.1 - t * 0.6 + seed * 2.0);
      y += 0.04 * sin(uv.x * 11.0 + t * 1.3 + seed * 3.0);

      // Vertical offset per bolt
      y -= (seed * 0.07) - 0.05;

      float d = abs(y);

      // Hot core — thin and bright
      float core = 0.0015 / (d + 0.002);
      // Inner glow
      float inner = 0.012 / (d + 0.025);
      // Outer halo
      float outer = 0.08 / (d + 0.22);

      // Fade the bolt along x so it feels like it has a tail
      float tail = smoothstep(-1.4, -0.3, uv.x) *
                   (1.0 - smoothstep(0.6, 1.4, uv.x));

      // Flicker along the length
      float flick = 0.85 +
        0.15 * sin(uv.x * 24.0 + t * 11.0 + seed * 9.0);
      flick *= 0.85 + 0.15 * fbm(vec2(uv.x * 6.0 + t * 2.0, seed));

      vec3 col = tint * (inner + outer * 0.6) * flick * tail;
      col += vec3(1.0) * core * flick * tail; // white hot centre
      return col;
    }
  `;

  const fsSource = isWebGL2
    ? `#version 300 es
${fsShared}
uniform vec2 u_resolution;
uniform float u_time;
out vec4 outColor;
void main() {
${fsBody}
}`
    : `
${fsShared}
uniform vec2 u_resolution;
uniform float u_time;
#define outColor gl_FragColor
void main() {
${fsBody}
}`;

  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn("Lightning shader compile failed:", gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  };

  const vs = compile(gl.VERTEX_SHADER, vsSource);
  const fs = compile(gl.FRAGMENT_SHADER, fsSource);
  if (!vs || !fs) return;

  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn("Lightning program link failed:", gl.getProgramInfoLog(program));
    return;
  }
  gl.useProgram(program);

  const posLoc = gl.getAttribLocation(program, "a_position");
  const resLoc = gl.getUniformLocation(program, "u_resolution");
  const timeLoc = gl.getUniformLocation(program, "u_time");

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  const pixelRatioCap = 1.0; // half-res on retina; soft bolts hide it
  let width = 0;
  let height = 0;

  const resize = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, pixelRatioCap);
    const w = Math.max(1, Math.floor(window.innerWidth * ratio));
    const h = Math.max(1, Math.floor(window.innerHeight * ratio));
    if (w === width && h === height) return;
    width = w;
    height = h;
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
  };

  resize();
  window.addEventListener("resize", resize, { passive: true });

  const start = performance.now();
  let paused = false;
  let rafId = 0;

  const render = (now) => {
    rafId = 0;
    if (paused) return;
    const t = (now - start) * 0.001;
    gl.uniform2f(resLoc, width, height);
    gl.uniform1f(timeLoc, t);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (!reduceMotion) {
      rafId = requestAnimationFrame(render);
    }
  };

  const schedule = () => {
    if (!rafId && !paused) rafId = requestAnimationFrame(render);
  };

  document.addEventListener("visibilitychange", () => {
    paused = document.hidden;
    if (paused && rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    } else {
      schedule();
    }
  });

  schedule();
})();
