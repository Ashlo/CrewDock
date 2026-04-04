const MIN_PARTICLES = 28
const MAX_PARTICLES = 68
const PARTICLE_AREA_TARGET = 14000
const POINTER_RADIUS = 220
const MAX_DEVICE_PIXEL_RATIO = 2

export function syncLauncherParticles(runtimeStore, root) {
  const canvas = root?.querySelector?.("[data-launcher-particles]") || null
  if (!(canvas instanceof HTMLCanvasElement)) {
    destroyLauncherParticles(runtimeStore)
    return
  }

  if (runtimeStore.launcherParticles?.canvas === canvas) {
    resizeLauncherParticles(runtimeStore.launcherParticles)
    return
  }

  destroyLauncherParticles(runtimeStore)
  runtimeStore.launcherParticles = createLauncherParticles(canvas)
}

export function destroyLauncherParticles(runtimeStore) {
  const state = runtimeStore.launcherParticles
  if (!state) {
    return
  }

  state.destroy()
  runtimeStore.launcherParticles = null
}

function createLauncherParticles(canvas) {
  const host = canvas.closest(".workspace-empty") || canvas.parentElement || canvas
  const context = canvas.getContext("2d")
  if (!context) {
    return {
      canvas,
      destroy() {},
    }
  }

  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
  const state = {
    canvas,
    context,
    host,
    motionQuery,
    particles: [],
    frame: 0,
    resizeObserver: null,
    width: 0,
    height: 0,
    devicePixelRatio: 1,
    pointerX: 0,
    pointerY: 0,
    pointerActive: false,
    lastTimestamp: performance.now(),
    onPointerMove: null,
    onPointerLeave: null,
    onVisibilityChange: null,
    onMotionChange: null,
    destroy() {},
  }

  state.onPointerMove = (event) => {
    const bounds = state.canvas.getBoundingClientRect()
    state.pointerX = event.clientX - bounds.left
    state.pointerY = event.clientY - bounds.top
    state.pointerActive = true
  }

  state.onPointerLeave = () => {
    state.pointerActive = false
  }

  state.onVisibilityChange = () => {
    state.lastTimestamp = performance.now()
    if (!document.hidden && !state.motionQuery.matches && !state.frame) {
      state.frame = requestAnimationFrame((timestamp) => stepLauncherParticles(state, timestamp))
    }
  }

  state.onMotionChange = () => {
    state.lastTimestamp = performance.now()
    resizeLauncherParticles(state)
    if (state.motionQuery.matches) {
      if (state.frame) {
        cancelAnimationFrame(state.frame)
        state.frame = 0
      }
      drawLauncherParticles(state)
      return
    }

    if (!state.frame) {
      state.frame = requestAnimationFrame((timestamp) => stepLauncherParticles(state, timestamp))
    }
  }

  host.addEventListener("pointermove", state.onPointerMove, { passive: true })
  host.addEventListener("pointerleave", state.onPointerLeave, { passive: true })
  document.addEventListener("visibilitychange", state.onVisibilityChange)
  addMediaQueryChangeListener(motionQuery, state.onMotionChange)

  if (typeof ResizeObserver === "function") {
    state.resizeObserver = new ResizeObserver(() => resizeLauncherParticles(state))
    state.resizeObserver.observe(host)
  } else {
    window.addEventListener("resize", state.onMotionChange, { passive: true })
  }

  resizeLauncherParticles(state)
  drawLauncherParticles(state)

  if (!motionQuery.matches) {
    state.frame = requestAnimationFrame((timestamp) => stepLauncherParticles(state, timestamp))
  }

  state.destroy = () => {
    if (state.frame) {
      cancelAnimationFrame(state.frame)
      state.frame = 0
    }

    if (state.resizeObserver) {
      state.resizeObserver.disconnect()
    } else {
      window.removeEventListener("resize", state.onMotionChange)
    }

    host.removeEventListener("pointermove", state.onPointerMove)
    host.removeEventListener("pointerleave", state.onPointerLeave)
    document.removeEventListener("visibilitychange", state.onVisibilityChange)
    removeMediaQueryChangeListener(motionQuery, state.onMotionChange)
  }

  return state
}

function resizeLauncherParticles(state) {
  const bounds = state.host.getBoundingClientRect()
  const width = Math.max(1, Math.round(bounds.width))
  const height = Math.max(1, Math.round(bounds.height))
  const devicePixelRatio = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO)
  const backingWidth = Math.max(1, Math.round(width * devicePixelRatio))
  const backingHeight = Math.max(1, Math.round(height * devicePixelRatio))

  state.width = width
  state.height = height
  state.devicePixelRatio = devicePixelRatio

  if (state.canvas.width !== backingWidth || state.canvas.height !== backingHeight) {
    state.canvas.width = backingWidth
    state.canvas.height = backingHeight
    state.canvas.style.width = `${width}px`
    state.canvas.style.height = `${height}px`
  }

  const nextCount = clampParticleCount(Math.round((width * height) / PARTICLE_AREA_TARGET))
  if (state.particles.length !== nextCount) {
    state.particles = Array.from({ length: nextCount }, () => createParticle(state))
  } else {
    for (const particle of state.particles) {
      particle.x = clamp(particle.x, -40, width + 40)
      particle.y = clamp(particle.y, -40, height + 40)
    }
  }

  if (!state.frame || state.motionQuery.matches) {
    drawLauncherParticles(state)
  }
}

function stepLauncherParticles(state, timestamp) {
  state.frame = 0
  const delta = Math.min((timestamp - state.lastTimestamp) / 16.6667, 2.2)
  state.lastTimestamp = timestamp

  if (!document.hidden) {
    updateLauncherParticles(state, delta)
    drawLauncherParticles(state)
  }

  if (!state.motionQuery.matches) {
    state.frame = requestAnimationFrame((nextTimestamp) => stepLauncherParticles(state, nextTimestamp))
  }
}

function updateLauncherParticles(state, delta) {
  const width = state.width
  const height = state.height
  const pointerX = state.pointerActive ? state.pointerX : width * 0.52
  const pointerY = state.pointerActive ? state.pointerY : height * 0.3

  for (const particle of state.particles) {
    particle.x += particle.vx * particle.speed * delta
    particle.y += particle.vy * particle.speed * delta

    if (particle.x < -48) {
      particle.x = width + 48
    } else if (particle.x > width + 48) {
      particle.x = -48
    }

    if (particle.y < -48) {
      particle.y = height + 48
    } else if (particle.y > height + 48) {
      particle.y = -48
    }

    let influenceX = 0
    let influenceY = 0

    if (state.pointerActive) {
      const dx = pointerX - particle.x
      const dy = pointerY - particle.y
      const distance = Math.hypot(dx, dy)
      if (distance < POINTER_RADIUS) {
        const pull = (1 - distance / POINTER_RADIUS) ** 2 * particle.magnetism
        influenceX = dx * pull
        influenceY = dy * pull
      }
    }

    particle.renderX += ((particle.x + influenceX) - particle.renderX) * particle.ease * delta
    particle.renderY += ((particle.y + influenceY) - particle.renderY) * particle.ease * delta
  }
}

function drawLauncherParticles(state) {
  const context = state.context
  const width = state.width
  const height = state.height
  const devicePixelRatio = state.devicePixelRatio

  context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
  context.clearRect(0, 0, width, height)

  for (const particle of state.particles) {
    context.beginPath()
    context.fillStyle = particle.glow
    context.arc(particle.renderX, particle.renderY, particle.radius * 3.8, 0, Math.PI * 2)
    context.fill()

    context.beginPath()
    context.fillStyle = particle.color
    context.arc(particle.renderX, particle.renderY, particle.radius, 0, Math.PI * 2)
    context.fill()
  }
}

function createParticle(state) {
  const width = state.width || 1
  const height = state.height || 1
  const depth = Math.random()
  const x = Math.random() * width
  const y = Math.random() * height
  const radius = 0.75 + depth * 1.75
  const alpha = 0.08 + depth * 0.26
  const hueShift = Math.random() > 0.82 ? 16 : 0

  return {
    x,
    y,
    renderX: x,
    renderY: y,
    vx: (Math.random() - 0.5) * 0.32,
    vy: (Math.random() - 0.5) * 0.26,
    speed: 0.55 + depth * 1.15,
    radius,
    ease: 0.028 + depth * 0.034,
    magnetism: 0.016 + depth * 0.024,
    color: `rgba(${136 + hueShift}, ${152 + hueShift}, 255, ${alpha})`,
    glow: `rgba(${126 + hueShift}, ${144 + hueShift}, 255, ${alpha * 0.13})`,
  }
}

function clampParticleCount(value) {
  return clamp(value, MIN_PARTICLES, MAX_PARTICLES)
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function addMediaQueryChangeListener(query, listener) {
  if (typeof query.addEventListener === "function") {
    query.addEventListener("change", listener)
    return
  }

  if (typeof query.addListener === "function") {
    query.addListener(listener)
  }
}

function removeMediaQueryChangeListener(query, listener) {
  if (typeof query.removeEventListener === "function") {
    query.removeEventListener("change", listener)
    return
  }

  if (typeof query.removeListener === "function") {
    query.removeListener(listener)
  }
}
