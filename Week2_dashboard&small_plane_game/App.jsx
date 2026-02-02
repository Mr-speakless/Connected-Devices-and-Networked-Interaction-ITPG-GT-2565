import { useState, useEffect, useRef } from 'react'
import './index.css'

function App() {
  const [isPlaying, setIsPlaying] = useState(false)
  const [planeY, setPlaneY] = useState(50) // Percentage from top (0-100)
  const [obstacles, setObstacles] = useState([])
  const [score, setScore] = useState(0)
  const [gameOver, setGameOver] = useState(false)
  const [rawSensorValue, setRawSensorValue] = useState(0)
  const [debugStatus, setDebugStatus] = useState("Initializing...")
  // Game Constants
  const GAME_SPEED = 3 // Pixels per frame
  const OBSTACLE_INTERVAL = 2000 // ms
  const OBSTACLE_WIDTH = 60
  const PLANE_SIZE = 20
  const PLANE_X = 100 // Fixed X position of the plane

  // Sensor Calibration
  const SENSOR_MIN = 90
  const SENSOR_MAX = 500

  // Refs for loop
  const requestRef = useRef()
  const lastTimeRef = useRef()
  const lastObstacleTimeRef = useRef(0)
  const obstaclesRef = useRef([])
  const planeYRef = useRef(50) // Fix: Track latest planeY for loop

  // --- 1. Sensor Polling (runs always) ---
  // --- 1. Sensor Polling (runs always) ---
  useEffect(() => {
    let isMounted = true
    let timeoutId = null

    const fetchSensor = async () => {
      if (!isMounted) return

      const controller = new AbortController()
      const signal = controller.signal

      // Auto-abort after 500ms if server causes a hang
      const fetchTimeoutId = setTimeout(() => controller.abort(), 500)

      try {
        // Fetch directly from the Python CORS server
        const res = await fetch(`http://localhost:8000/log.json?t=${Date.now()}`, { signal })
        clearTimeout(fetchTimeoutId) // Clear timeout on response

        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`)

        const text = await res.text()
        const lines = text.trim().split('\n')

        // Find last valid JSON
        let lastValidSensor = null
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            const data = JSON.parse(lines[i])
            if (data && data.sensor !== undefined) {
              let val = Number(data.sensor)
              setRawSensorValue(val)

              // New Logic: Clamp to 90-500 range
              if (val < SENSOR_MIN) val = SENSOR_MIN
              if (val > SENSOR_MAX) val = SENSOR_MAX

              lastValidSensor = val
              break
            }
          } catch (e) {
            // Ignore invalid lines
          }
        }

        if (lastValidSensor !== null) {
          // Normalize to 0-100 range
          let pct = 100 - ((lastValidSensor - SENSOR_MIN) / (SENSOR_MAX - SENSOR_MIN)) * 100
          pct = Math.max(0, Math.min(100, pct))

          setPlaneY(pct)
          planeYRef.current = pct // Update ref too!
          setDebugStatus(`OK: ${new Date().toLocaleTimeString()}`)
        } else {
          setDebugStatus("No valid sensor data found")
        }
      } catch (err) {
        if (err.name === 'AbortError') {
          setDebugStatus("Polling timed out")
        } else {
          console.error("Sensor fetch error:", err)
          setDebugStatus(`Error: ${err.message}`)
        }
      } finally {
        // Schedule next poll ONLY after this one finishes (or fails)
        if (isMounted) {
          timeoutId = setTimeout(fetchSensor, 100)
        }
      }
    }

    // Start the loop
    fetchSensor()

    return () => {
      isMounted = false
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [])

  // --- 2. Game Logic Loop ---
  // Sync state to ref for game loop use
  useEffect(() => {
    obstaclesRef.current = obstacles
  }, [obstacles])

  const startGame = () => {
    setIsPlaying(true)
    setGameOver(false)
    setScore(0)
    setObstacles([])
    obstaclesRef.current = []
    lastTimeRef.current = performance.now()
    requestRef.current = requestAnimationFrame(gameLoop)
  }

  const gameLoop = (time) => {
    if (!lastTimeRef.current) lastTimeRef.current = time
    const deltaTime = time - lastTimeRef.current
    lastTimeRef.current = time

    // Spawning Obstacles
    if (time - lastObstacleTimeRef.current > OBSTACLE_INTERVAL) {
      const gapHeight = 40 // percent height
      const gapTop = Math.random() * (100 - gapHeight) // random position

      const newObstacle = {
        id: Date.now(),
        x: window.innerWidth, // Start off-screen right
        gapTop: gapTop, // % from top
        gapHeight: gapHeight, // % height
        passed: false
      }

      obstaclesRef.current = [...obstaclesRef.current, newObstacle]
      lastObstacleTimeRef.current = time
    }

    // Move Obstacles
    const nextObstacles = obstaclesRef.current.map(obs => ({
      ...obs,
      x: obs.x - GAME_SPEED
    })).filter(obs => obs.x > -OBSTACLE_WIDTH) // Remove off-screen

    // === COLLISION LOGIC START ===
    // We treat the plane as a simple rectangle box.
    // planeRect: { l: left_x, r: right_x, t: top_y, b: bottom_y }
    const screenHeight = window.innerHeight

    // Fix: Use ref instead of stale state
    const currentPlaneY = planeYRef.current

    const planeRect = {
      l: PLANE_X,                    // Fixed: 100px
      r: PLANE_X + PLANE_SIZE,       // Fixed: 140px (100 + 40)
      t: (currentPlaneY / 100) * screenHeight,
      b: (currentPlaneY / 100) * screenHeight + PLANE_SIZE
    }

    let collided = false
    nextObstacles.forEach(obs => {
      // Obstacle Rects (Top and Bottom parts)
      const obsL = obs.x
      const obsR = obs.x + OBSTACLE_WIDTH // 60px wide

      // Calculate split point for pipes (gap)

      const topPipeH = (obs.gapTop / 100) * screenHeight
      const bottomPipeY = ((obs.gapTop + obs.gapHeight) / 100) * screenHeight

      // 1. Check Top Pipe Collision
      // IF plane Right > pipe Left AND plane Left < pipe Right (Horizontal Overlap)
      // AND plane Top < pipe Height (Vertical Overlap with top pipe)
      if (
        planeRect.r > obsL && planeRect.l < obsR &&
        planeRect.t < topPipeH
      ) {
        collided = true
      }

      // 2. Check Bottom Pipe Collision
      // IF plane Right > pipe Left AND plane Left < pipe Right (Horizontal Overlap)
      // AND plane Bottom > bottom pipe Starts (Vertical Overlap with bottom pipe)
      if (
        planeRect.r > obsL && planeRect.l < obsR &&
        planeRect.b > bottomPipeY
      ) {
        collided = true
      }
    })
    // === COLLISION LOGIC END ===

    if (collided) {
      setIsPlaying(false)
      setGameOver(true)
      cancelAnimationFrame(requestRef.current)
      return // Stop loop
    }

    // Update Score
    nextObstacles.forEach(obs => {
      if (!obs.passed && obs.x + OBSTACLE_WIDTH < PLANE_X) {
        obs.passed = true
        setScore(s => s + 1)
      }
    })

    setObstacles(nextObstacles)
    requestRef.current = requestAnimationFrame(gameLoop)
  }

  // Cleanup loop on unmount or pause
  useEffect(() => {
    return () => cancelAnimationFrame(requestRef.current)
  }, [])


  return (
    <div className="game-container">
      {/* Background with parallax or moving effect */}
      <div className={`sky ${isPlaying ? 'animating' : ''}`}></div>

      {/* Game Area */}
      <div className="game-world">

        {/* Plane */}
        <div
          className="plane"
          style={{
            top: `${planeY}%`,
            left: `${PLANE_X}px`,
            width: `${PLANE_SIZE}px`,
            height: `${PLANE_SIZE}px`,
            //backgroundColor: 'rgba(255, 0, 0, 0.5)', // Debug: Show Hitbox
            //border: '1px solid red' // Debug
          }}
        >
          ✈️
          {/* Optional: Add debug height text if needed */}
          {/* <span style={{fontSize:10}}>{Math.round(planeY)}%</span> */}
        </div>

        {/* Obstacles */}
        {obstacles.map(obs => (
          <div key={obs.id} className="obstacle-group" style={{ left: obs.x, width: OBSTACLE_WIDTH }}>
            <div
              className="pipe top"
              style={{ height: `${obs.gapTop}%` }}
            />
            <div
              className="pipe bottom"
              style={{ top: `${obs.gapTop + obs.gapHeight}%`, height: `${100 - (obs.gapTop + obs.gapHeight)}%` }}
            />
          </div>
        ))}

      </div>

      {/* UI Overlay */}
      <div className="ui-layer">
        <div className="debug-stats">
          <div>Sensor: {rawSensorValue}</div>
          <div style={{ fontSize: 12, color: '#ffecbd' }}>{debugStatus}</div>
        </div>
        <div className="score">Score: {score}</div>

        {(!isPlaying && !gameOver) && (
          <div className="modal">
            <h1>Ready to Fly?</h1>
            <p>Control height with your sensor.</p>
            <button onClick={startGame}>PLAY</button>
          </div>
        )}

        {gameOver && (
          <div className="modal">
            <h1>GAME OVER</h1>
            <p>Score: {score}</p>
            <button onClick={startGame}>TRY AGAIN</button>
          </div>
        )}
      </div>

    </div>
  )
}

export default App
