import { useEffect, useRef, useState } from 'react';
import { balance } from '../constants/balance';
import { useGameStore } from '../stores/gameStore';
import type { LatLng } from '@shukajpes/shared';

// Ported from demo lines 233-246. Smooth orbit around the user
// position with varying radius (sin wobble) and angle interpolation
// toward random targets. Pauses when the radial menu is open.
export function useCompanion(userPos: LatLng | null): LatLng | null {
  const [pos, setPos] = useState<LatLng | null>(null);
  const angleRef = useRef(Math.random() * Math.PI * 2);
  const targetRef = useRef(angleRef.current);
  const frameRef = useRef(0);

  useEffect(() => {
    if (!userPos) return;

    const id = setInterval(() => {
      const menuOpen = useGameStore.getState().menuOpen;
      if (menuOpen) return;

      frameRef.current += 1;
      const now = Date.now();

      // New random target angle roughly every 200 frames (~20s at 100ms tick).
      if (Math.random() < 0.005) {
        targetRef.current = Math.random() * Math.PI * 2;
      }

      let diff = targetRef.current - angleRef.current;
      if (diff > Math.PI) diff -= Math.PI * 2;
      if (diff < -Math.PI) diff += Math.PI * 2;

      angleRef.current += diff * 0.02 + Math.sin(now / 3000) * 0.005;

      const roamR =
        balance.roamRadius +
        Math.sin(now / balance.roamRadiusWobblePeriod) * balance.roamRadiusWobble;

      setPos({
        lat: userPos.lat + Math.sin(angleRef.current) * roamR,
        lng: userPos.lng + Math.cos(angleRef.current) * roamR,
      });
    }, balance.roamTick);

    return () => clearInterval(id);
  }, [userPos?.lat, userPos?.lng]);

  return pos;
}
