(() => {
  const canvas = document.getElementById("liquidCanvas");
  if (!canvas) return;
  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: false,
    depth: false,
    powerPreference: "low-power",
  });
  const toggle = document.getElementById("motionToggle");
  if (!gl) {
    toggle.hidden = true;
    return;
  }
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const transparency = matchMedia("(prefers-reduced-transparency: reduce)");
  let program,
    resolution,
    viewport,
    panels,
    shapes,
    textureReady,
    time,
    dark,
    frame = 0,
    last = 0,
    elapsed = 18,
    lost = false;
  const vertex = `attribute vec2 position; void main(){gl_Position=vec4(position,0.,1.);}`;
  const fragment = `precision highp float;
uniform vec2 resolution;
uniform vec2 viewport;
uniform vec4 panels[16];
uniform vec2 shapes[16];
uniform float time;
uniform float dark;
uniform sampler2D liquidTexture;
uniform float textureReady;
// A continuous water surface; the wave spectrum has no emissive component.
float water(vec2 p) {
  float t=time*.12;
  return .095*sin(dot(p,vec2(.82,.31))+t*.6)
    +.065*sin(dot(p,vec2(-.56,1.12))-t*.49)
    +.027*sin(dot(p,vec2(1.87,1.28))+t*.82)
    +.014*sin(dot(p,vec2(-3.8,2.7))-t*1.02)
    +.005*sin(dot(p,vec2(7.6,5.1))+t*1.21)
    +.002*sin(dot(p,vec2(-14.3,9.4))-t*1.4);
}
vec3 normalAt(vec2 p) {
  float t=time*.12;
  vec2 g=.095*vec2(.82,.31)*cos(dot(p,vec2(.82,.31))+t*.6)
    +.065*vec2(-.56,1.12)*cos(dot(p,vec2(-.56,1.12))-t*.49)
    +.027*vec2(1.87,1.28)*cos(dot(p,vec2(1.87,1.28))+t*.82)
    +.014*vec2(-3.8,2.7)*cos(dot(p,vec2(-3.8,2.7))-t*1.02)
    +.005*vec2(7.6,5.1)*cos(dot(p,vec2(7.6,5.1))+t*1.21)
    +.002*vec2(-14.3,9.4)*cos(dot(p,vec2(-14.3,9.4))-t*1.4);
  return normalize(vec3(-g.x,1.,-g.y));
}
// An extended studio environment reflected by both water and glass.
// Broad neutral illumination replaces neon caustics and luminous outlines.
vec3 environment(vec3 r) {
  vec3 col=vec3(.22,.28,.27)+.1*smoothstep(-.2,.9,r.y);
  float window=exp(-pow((r.x+.16)/.32,2.)-pow((r.z+.5)/.72,2.));
  col=mix(col,vec3(.90,.92,.90),window*.85);
  float side=exp(-pow((r.x-.58+r.z*.15)/.19,2.));
  return mix(col,vec3(.62,.67,.65),side*.35);
}
float roundedBox(vec2 p,vec2 b,float r){vec2 q=abs(p)-b+r;return length(max(q,0.))+min(max(q.x,q.y),0.)-r;}
vec3 traceWater(vec2 uv){
  if(textureReady>.5){
    float aspect=viewport.x/viewport.y;
    vec2 photo=uv*min(1.,1.5/aspect)/vec2(1.5,1.)*.5+.5;
    vec3 normal=normalAt(uv*2.);
    // Advect a photographic material with a continuous, low-amplitude flow field.
    // This is image-based animation, not a claim of a full fluid simulation.
    vec2 flow=vec2(sin(uv.y*2.8+time*.09),cos(uv.x*2.2-time*.07))*.006;
    photo+=flow+normal.xz*.025;
    vec3 color=texture2D(liquidTexture,clamp(photo*.78+.11,.001,.999)).rgb;
    color=vec3(.12)+color*.83;
    return mix(color,color*vec3(.24,.30,.29),dark);
  }

  vec3 eye=vec3(0.,3.5,4.);
  vec3 ray=normalize(vec3(uv.x*.65,-.85,uv.y*.55-.85));
  float distance=-eye.y/ray.y;
  for(int i=0;i<2;i++){vec3 p=eye+ray*distance;distance+=(water(p.xz)-p.y)/ray.y;}
  vec3 p=eye+ray*distance;
  vec3 n=normalAt(p.xz);
  n=normalize(vec3(n.x*1.8,n.y,n.z*1.8));
  vec3 reflected=environment(reflect(ray,n));
  vec3 transmitted=refract(ray,n,1./1.333);
  float depth=(p.y+2.4)/max(-transmitted.y,.1);
  vec3 absorption=exp(-vec3(.17,.09,.105)*depth);
  vec3 floorColor=vec3(.56,.65,.61)*absorption+vec3(.27,.40,.37)*(1.-absorption);
  float fresnel=.02+.98*pow(1.-max(dot(-ray,n),0.),5.);
  vec3 color=mix(floorColor,reflected,.70+fresnel*.30);
  // Tone-range is bounded; no bloom, glowing seams, or point-light glare.
  color=vec3(.34,.38,.36)+color*.64;
  return mix(color,color*vec3(.23,.29,.29),dark);
}
void main(){
  vec2 screen=vec2(gl_FragCoord.x/resolution.x,1.-gl_FragCoord.y/resolution.y)*viewport;
  vec2 uv=(gl_FragCoord.xy*2.-resolution)/resolution.y;
  vec3 reflection=vec3(0.);
  float reflectionWeight=0.;
  for(int i=0;i<16;i++){
    vec4 rect=panels[i];
    if(rect.z>0.){
      vec2 local=screen-rect.xy;
      float radius=shapes[i].x;
      float d=roundedBox(local,rect.zw*.5,radius);
      if(d<0.){
        vec2 gradient=vec2(roundedBox(local+vec2(.25,0.),rect.zw*.5,radius)-d,roundedBox(local+vec2(0.,.25),rect.zw*.5,radius)-d);
        vec2 outward=normalize(gradient+vec2(.00001));
        float edge=clamp(1.+d/shapes[i].y,0.,1.);
        // Rounded meniscus normal. Snell refraction traces through the clear slab.
        float slope=sin(edge*1.5707963)*.995;
        vec3 n=normalize(vec3(outward.x*slope,-outward.y*slope,sqrt(max(1.-slope*slope,.01))));
        vec3 transmitted=refract(vec3(0.,0.,-1.),n,1./1.46);
        uv+=transmitted.xy/max(-transmitted.z,.1)*(28./viewport.y)*2.;
        float fresnel=.035+.965*pow(1.-n.z,5.);
        vec3 reflected=reflect(vec3(0.,0.,-1.),n);
        vec3 light=vec3(.30)+vec3(.68)*exp(-pow((reflected.x+.35)/.8,2.)-pow((reflected.y-.35)/1.0,2.));
        float rim=smoothstep(.84,1.,edge);
        // Directional edge reflection, not an evenly painted white border.
        float highlight=pow(max(dot(n,normalize(vec3(-.48,.64,.58))),0.),18.);
        reflection+=light*(fresnel*.78+highlight*.30)*mix(1.,.65,dark);
        reflectionWeight+=fresnel*.35;
        reflection-=vec3(rim*.035*max(dot(outward,vec2(.7,.7)),0.));
      }
    }
  }
  vec3 color=traceWater(uv)*(1.-min(reflectionWeight,.3))+reflection;
  gl_FragColor=vec4(clamp(color,0.,1.),1.);
}
`;
  function shader(type, source) {
    const result = gl.createShader(type);
    gl.shaderSource(result, source);
    gl.compileShader(result);
    if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) {
      gl.deleteShader(result);
      return null;
    }
    return result;
  }
  function setup() {
    const vs = shader(gl.VERTEX_SHADER, vertex),
      fs = shader(gl.FRAGMENT_SHADER, fragment);
    if (!vs || !fs) return false;
    program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    resolution = gl.getUniformLocation(program, "resolution");
    viewport = gl.getUniformLocation(program, "viewport");
    panels = gl.getUniformLocation(program, "panels[0]");
    shapes = gl.getUniformLocation(program, "shapes[0]");
    time = gl.getUniformLocation(program, "time");
    dark = gl.getUniformLocation(program, "dark");
    textureReady = gl.getUniformLocation(program, "textureReady");
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGB,
      1,
      1,
      0,
      gl.RGB,
      gl.UNSIGNED_BYTE,
      new Uint8Array([170, 185, 180]),
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.uniform1i(gl.getUniformLocation(program, "liquidTexture"), 0);
    const photo = new Image();
    photo.onload = () => {
      if (lost) return;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, photo);
      gl.uniform1f(textureReady, 1);
      canvas.dataset.material = "photographic-water";
      draw();
    };
    photo.src = "/* LIQUID_TEXTURE */";
    canvas.dataset.renderer = "refractive-glass";
    return true;
  }
  let panelRects = new Float32Array(64);
  let panelShapes = new Float32Array(32);
  function measurePanels() {
    const visible = [
      ...document.querySelectorAll(
        ".sidebar,.shell>header,.prompt-wrap,#appSettings,#sidebarToggle,#mobileMenu,#newChat,.suggestions button,.upload,.settings summary,dialog[open],.settings[open] .controls",
      ),
    ]
      .filter(
        (el) =>
          el.getClientRects().length &&
          !el.dataset.liquidTransition &&
          !el.classList.contains("liquid-underlay"),
      )
      .slice(0, 16);
    panelRects.fill(0);
    panelShapes.fill(0);
    visible.forEach((el, i) => {
      if (
        !el ||
        !el.getClientRects().length ||
        getComputedStyle(el).visibility === "hidden"
      )
        return;
      const r = el.getBoundingClientRect();
      const radius = Math.min(
        parseFloat(getComputedStyle(el).borderTopLeftRadius) || 16,
        r.height / 2,
        r.width / 2,
      );
      panelShapes.set([radius, Math.min(12, radius * 0.7)], i * 2);
      panelRects.set(
        [r.x + r.width / 2, r.y + r.height / 2, r.width, r.height],
        i * 4,
      );
    });
    draw();
  }
  addEventListener("liquidlayerchange", measurePanels);
  function draw() {
    if (lost) return;
    gl.uniform2f(resolution, canvas.width, canvas.height);
    gl.uniform2f(viewport, innerWidth, innerHeight);
    gl.uniform4fv(panels, panelRects);
    gl.uniform2fv(shapes, panelShapes);
    gl.uniform1f(time, elapsed);
    gl.uniform1f(
      dark,
      document.documentElement.dataset.theme === "dark" ? 1 : 0,
    );
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    canvas.classList.add("ready");
  }
  function resize() {
    // Keep GPU work bounded, including on Retina displays.
    const scale = Math.min(
      devicePixelRatio,
      1.25,
      Math.sqrt(650000 / (innerWidth * innerHeight)),
    );
    canvas.width = Math.round(innerWidth * scale);
    canvas.height = Math.round(innerHeight * scale);
    gl.viewport(0, 0, canvas.width, canvas.height);
    draw();
  }
  let timer = 0,
    userPaused = false;
  try {
    userPaused = localStorage.getItem("hanzagent-background-paused") === "true";
  } catch {}
  function updateToggle() {
    const paused = userPaused || motion.matches || transparency.matches;
    const en = document.documentElement.lang === "en";
    const label = paused
      ? en
        ? "Resume background motion"
        : "继续背景流动"
      : en
        ? "Pause background motion"
        : "暂停背景流动";
    toggle.setAttribute("aria-pressed", String(paused));
    toggle.setAttribute("aria-label", label);
    toggle.title = label;
    toggle.disabled = motion.matches || transparency.matches;
    if (toggle.disabled)
      toggle.title = en
        ? "Motion reduced by system settings"
        : "已遵循系统减少动态效果设置";
  }
  function animate(now) {
    frame = 0;
    timer = setTimeout(() => {
      frame = requestAnimationFrame(animate);
    }, 1000 / 24);
    elapsed += Math.min((now - last) / 1000, 0.1);
    last = now;
    draw();
  }
  function resume() {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    frame = 0;
    last = performance.now();
    const paused =
      userPaused ||
      lost ||
      document.hidden ||
      motion.matches ||
      transparency.matches ||
      document.body.classList.contains("busy");
    updateToggle();
    canvas.dataset.motion = paused ? "paused" : "flowing";
    if (!lost && !document.hidden) draw();
    if (!paused) frame = requestAnimationFrame(animate);
  }
  toggle.addEventListener("click", () => {
    userPaused = !userPaused;
    try {
      localStorage.setItem("hanzagent-background-paused", String(userPaused));
    } catch {}
    resume();
  });
  new MutationObserver(updateToggle).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["lang"],
  });
  addEventListener("storage", (e) => {
    if (e.key === "hanzagent-background-paused" || e.key === null) {
      userPaused = e.newValue === "true";
      resume();
    }
  });
  if (!setup()) {
    toggle.hidden = true;
    return;
  }
  resize();
  const layoutObserver = new ResizeObserver(measurePanels);
  document
    .querySelectorAll(
      ".sidebar,.shell>header,.prompt-wrap,dialog,.settings .controls",
    )
    .forEach((el) => layoutObserver.observe(el));
  const dialogObserver = new MutationObserver(measurePanels);
  document.querySelectorAll("dialog,.settings").forEach((el) =>
    dialogObserver.observe(el, {
      attributes: true,
      attributeFilter: ["open"],
    }),
  );
  document
    .querySelector(".shell")
    .addEventListener("transitionend", measurePanels);
  measurePanels();
  resume();
  addEventListener("resize", () => {
    resize();
    measurePanels();
  });
  document.addEventListener("visibilitychange", resume);
  motion.addEventListener("change", resume);
  transparency.addEventListener("change", resume);
  new MutationObserver(() => {
    draw();
    resume();
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  let wasBusy = document.body.classList.contains("busy");
  new MutationObserver(() => {
    const isBusy = document.body.classList.contains("busy");
    if (wasBusy !== isBusy) {
      wasBusy = isBusy;
      resume();
    }
  }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    lost = true;
    canvas.classList.remove("ready");
    resume();
  });
  canvas.addEventListener("webglcontextrestored", () => {
    lost = !setup();
    if (!lost) {
      resize();
      resume();
    }
  });
})();
