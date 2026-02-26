import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Stars, Image, Text, Float, MeshDistortMaterial, Billboard } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

const getStableColor = (str: string) => {
  if (!str || str === "Autres" || str === "Signal Original") return "#4b5563";
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash % 360)}, 75%, 65%)`;
};

function ArtistNode({ node, position, viewType, color, isSelected, onSelect, isVisible }: any) {
  const contentRef = useRef<THREE.Group>(null);
  const materialRef = useRef<any>(null);
  const ringMaterialRef = useRef<any>(null);
  
  const size = useMemo(() => node.popularity / 35 + 0.5, [node.popularity]);

  useFrame((state) => {
    if (contentRef.current) {
      // 1. Animation fluide du Scale
      const targetScale = isVisible ? 1 : 0.001;
      contentRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.1);
      
      // 2. Animation fluide de l'Opacité
      const targetOpacity = isVisible ? 1 : 0;
      if (materialRef.current) {
        materialRef.current.opacity = THREE.MathUtils.lerp(materialRef.current.opacity, targetOpacity, 0.1);
        
        // --- LOGIQUE DE PULSATION ---
        // Si sélectionné : ultra brillant fixe (15)
        // Si récent en vue globale : pulse entre 4 et 10
        // Sinon : lueur stable (2)
        if (isSelected) {
          materialRef.current.emissiveIntensity = 15;
        } else if (viewType === 'all' && node.is_recent) {
          const pulse = (Math.sin(state.clock.elapsedTime * 2) + 1) * 1.5 + 3;
          materialRef.current.emissiveIntensity = pulse;
        } else {
          materialRef.current.emissiveIntensity = 2;
        }
      }
      
      if (ringMaterialRef.current) {
        ringMaterialRef.current.opacity = THREE.MathUtils.lerp(ringMaterialRef.current.opacity, targetOpacity, 0.1);
      }

      // 3. Animation de flottement
      contentRef.current.position.y = Math.sin(state.clock.elapsedTime * 0.5 + node.popularity) * 0.2;
      
      // 4. Optimisation
      contentRef.current.visible = contentRef.current.scale.x > 0.02;
    }
  });

  return (
    <group position={position}>
      <Float speed={1.5} rotationIntensity={0.5} floatIntensity={0.5}>
        <group ref={contentRef}>
          <mesh 
            onPointerOver={(e) => { if(!isVisible) return; e.stopPropagation(); document.body.style.cursor = 'pointer'; }} 
            onPointerOut={() => { document.body.style.cursor = 'auto'; }}
            onClick={(e) => {
              if(!isVisible) return;
              e.stopPropagation();
              onSelect(isSelected ? null : node);
            }}
          >
            <sphereGeometry args={[size, 32, 32]} />
            <MeshDistortMaterial 
              ref={materialRef}
              color={color} 
              emissive={color}
              distort={isSelected ? 0.3 : 0.15} 
              speed={2} 
              toneMapped={false}
              transparent={true}
              opacity={0} 
            />
          </mesh>
          
          {node.top_track && (
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[size + 0.4, 0.03, 16, 32]} />
              <meshStandardMaterial 
                ref={ringMaterialRef}
                color="#facc15" 
                emissive="#facc15" 
                emissiveIntensity={4} 
                toneMapped={false} 
                transparent={true}
                opacity={0}
              />
            </mesh>
          )}

          <Billboard follow={true}>
            <Image 
              url={node.image} 
              position={[0, size + 1.4, 0]} 
              scale={[1.8, 1.8]} 
              transparent 
              opacity={isVisible ? (isSelected ? 1 : 0.7) : 0} 
            />
            <Text 
              position={[0, -size - 1.2, 0]} 
              fontSize={0.35} 
              color="white" 
              maxWidth={4} 
              textAlign="center"
              fillOpacity={isVisible ? 1 : 0}
            >
              {node.name.toUpperCase()}
            </Text>
          </Billboard>
        </group>
      </Float>
    </group>
  );
}

function SceneContent({ data, viewType, onNodeSelect, selectedNode, activeFilter }: any) {
  const nodes = useMemo(() => {
    const spread = 55;
    const clusterStrength = 0.55;
    const groups = Array.from(new Set(data.map((d: any) => 
        viewType === 'all' ? (d.genres && d.genres.length > 0 ? d.genres[0] : "Autres") : d.artist_name
    )));
    
    const centers = new Map();
    groups.forEach((g, i) => {
      const phi = Math.acos(-1 + (2 * i) / groups.length);
      const theta = Math.sqrt(groups.length * Math.PI) * phi;
      centers.set(g, [Math.cos(theta) * Math.sin(phi) * spread, Math.sin(theta) * Math.sin(phi) * spread, Math.cos(phi) * spread]);
    });

    return data.map((item: any) => {
      const key = viewType === 'all' ? (item.genres && item.genres.length > 0 ? item.genres[0] : "Autres") : item.artist_name;
      const center = centers.get(key) || [0,0,0];
      const randomPos = [(Math.random() - 0.5) * spread * 2.5, (Math.random() - 0.5) * spread * 2.5, (Math.random() - 0.5) * spread * 2.5];
      
      return { 
        ...item, 
        color: getStableColor(key), 
        pos: [
          center[0] * clusterStrength + randomPos[0] * (1 - clusterStrength), 
          center[1] * clusterStrength + randomPos[1] * (1 - clusterStrength), 
          center[2] * clusterStrength + randomPos[2] * (1 - clusterStrength)
        ] 
      };
    });
  }, [data, viewType]);

  return (
    <>
      <Stars radius={150} depth={50} count={5000} factor={4} fade speed={1} />
      <ambientLight intensity={0.5} />
      <pointLight position={[50, 50, 50]} intensity={2} />
      
      {nodes.map((node: any, index: number) => {
        let isVisible = true;
        if (activeFilter) {
          if (viewType === 'all') {
            const isFallbackFilter = activeFilter === "Autres" || activeFilter === "Signal Original";
            const hasNoGenres = !node.genres || node.genres.length === 0 || node.genres.includes("Signal Original");
            isVisible = isFallbackFilter ? hasNoGenres : (Array.isArray(node.genres) && node.genres.includes(activeFilter));
          } else {
            isVisible = node.artist_name === activeFilter;
          }
        }

        return (
          <ArtistNode 
            key={`${node.id}-${index}`}
            node={node} 
            position={node.pos} 
            viewType={viewType} 
            color={node.color}
            isSelected={selectedNode?.id === node.id}
            onSelect={onNodeSelect}
            isVisible={isVisible}
          />
        );
      })}

      <EffectComposer>
        <Bloom luminanceThreshold={0.2} intensity={1.2} mipmapBlur />
      </EffectComposer>
      
      <OrbitControls makeDefault autoRotate={true} autoRotateSpeed={0.2} enableDamping minDistance={20} maxDistance={220} />
    </>
  );
}

export default function Scene(props: any) {
  return (
    <div className="h-full w-full bg-[#010103]">
      <Canvas camera={{ position: [0, 20, 100], fov: 40 }} dpr={[1, 2]} onPointerMissed={() => props.onNodeSelect(null)}>
        <SceneContent {...props} />
      </Canvas>
    </div>
  );
}