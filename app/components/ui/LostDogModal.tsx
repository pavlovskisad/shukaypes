import type { NearbyLostDog } from '../../services/api';
import { SYSTEM_FONT } from '../../constants/fonts';

interface LostDogModalProps {
  dog: NearbyLostDog | null;
  onClose: () => void;
  onReportSighting?: (dog: NearbyLostDog) => void;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffM = Math.max(0, Math.round((now - then) / 60000));
  if (diffM < 60) return `${diffM}m ago`;
  const diffH = Math.round(diffM / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.round(diffH / 24);
  return `${diffD}d ago`;
}

// Slide-up dog detail sheet. Demo lines 105-113. First iteration — photo
// pop-ups and "I've seen this dog" reporting land in a later slice.
export function LostDogModal({ dog, onClose, onReportSighting }: LostDogModalProps) {
  if (!dog) return null;

  const urgent = dog.urgency === 'urgent';
  const badgeText = urgent ? '🚨 URGENT' : '⚠️ searching';
  const badgeBg = urgent ? '#fde8e8' : '#fdf3e0';
  const badgeFg = urgent ? '#e84040' : '#d9a030';

  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(0,0,0,0.3)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        // Lift the sheet above the floating tab bar (~60-80px) so the
        // "i've seen them" button isn't covered by the dashboard.
        paddingBottom: 80,
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#ffffff',
          borderRadius: 24,
          padding: '22px 20px 22px',
          width: '100%',
          maxWidth: 430,
          animation: 'dog-modal-up 0.3s cubic-bezier(0.4,0,0.2,1)',
          boxShadow: '0 -12px 40px rgba(0,0,0,0.2)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 14,
          }}
        >
          <span
            style={{
              background: badgeBg,
              color: badgeFg,
              borderRadius: 12,
              padding: '4px 10px',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 0.5,
            }}
          >
            {badgeText}
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: 24,
              cursor: 'pointer',
              color: '#777',
              lineHeight: 1,
            }}
            aria-label="close"
          >
            ×
          </button>
        </div>

        <div style={{ display: 'flex', gap: 14, marginBottom: 18, alignItems: 'center' }}>
          {dog.photoUrl ? (
            <img
              src={dog.photoUrl}
              alt={dog.name}
              style={{
                width: 68,
                height: 68,
                borderRadius: '50%',
                objectFit: 'cover',
                flexShrink: 0,
              }}
            />
          ) : (
            <div
              style={{
                width: 68,
                height: 68,
                borderRadius: '50%',
                background: '#f0f0f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 30,
                flexShrink: 0,
              }}
            >
              {dog.emoji}
            </div>
          )}
          <div>
            <div style={{ fontFamily: SYSTEM_FONT, fontSize: 24, fontWeight: 700 }}>
              {dog.name}
            </div>
            <div style={{ fontSize: 13, color: '#777', marginTop: 2 }}>{dog.breed}</div>
            <div style={{ fontSize: 12, color: '#777', marginTop: 3 }}>
              last seen {relativeTime(dog.lastSeen.at)}
            </div>
          </div>
        </div>

        <div
          style={{
            background: '#f0f0f0',
            borderRadius: 14,
            padding: '12px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 14,
          }}
        >
          <span style={{ fontSize: 22 }}>🐾</span>
          <div>
            <div style={{ fontFamily: SYSTEM_FONT, fontSize: 17, fontWeight: 700 }}>
              {dog.rewardPoints} pts reward
            </div>
            <div style={{ fontSize: 11, color: '#777' }}>bonus tokens near search zone</div>
          </div>
        </div>

        <button
          onClick={() => onReportSighting?.(dog)}
          style={{
            width: '100%',
            background: '#1a1a1a',
            color: '#ffffff',
            border: 'none',
            borderRadius: 16,
            padding: '14px 18px',
            fontFamily: SYSTEM_FONT,
            fontSize: 20,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          👀 i've seen them
        </button>

        <style>{`
          @keyframes dog-modal-up {
            from { transform: translateY(100%); }
            to { transform: translateY(0); }
          }
        `}</style>
      </div>
    </div>
  );
}
