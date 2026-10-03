import { Canvas, useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'

function Scene() {
  const mesh = useRef<THREE.Mesh>(null)

  useFrame((_, delta) => {
    if (mesh.current) {
      mesh.current.rotation.x += delta * 0.1
      mesh.current.rotation.y += delta * 0.2
    }
  })

  return (
    <mesh ref={mesh}>
      <icosahedronGeometry args={[2.2, 1]} />
      <meshBasicMaterial
        color="#22d3ee"
        wireframe
        transparent
        opacity={0.35}
      />
    </mesh>
  )
}

export default function Bg() {
  return (
    <div className="fixed inset-0 -z-10">
      <Canvas camera={{ position: [0, 0, 7] }}>
        <Scene />
      </Canvas>
    </div>
  )
}