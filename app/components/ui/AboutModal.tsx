import { useEffect, useState } from 'react';
import { SYSTEM_FONT } from '../../constants/fonts';
import { Z } from '../../constants/z';
import { Icon, type IconName } from './Icon';

interface AboutModalProps {
  open: boolean;
  onClose: () => void;
}

const SHEET_ANIM_MS = 280;

interface Row {
  // iconName takes precedence (renders the pixel <Icon>); emoji is
  // the fallback for surfaces we haven't drawn yet.
  iconName?: IconName;
  emoji?: string;
  title: string;
  body: string;
}

// Quick orientation written from шукайпес's voice — sensory + warm,
// not "feature → benefit." Reads like a dog giving a friend a quick
// tour of the map, one row per surface. Triggered from the top-left
// logo tap; mirrors the LostDogModal/SpotModal slide-up family.
const ROWS: Row[] = [
  {
    iconName: 'urgent',
    title: 'lost pets',
    body: "the ones with the red glow are missing right now — somebody's heart is heavy. tap one and i'll lead you to three spots where they might be hiding. ears up, nose down, off we go.",
  },
  {
    iconName: 'eyes',
    title: "if you spot one",
    body: "see one of these pets out there for real?! open their photo and tap the eye — i'll bark the news to everyone else looking. *full body wag*",
  },
  {
    iconName: 'search',
    title: 'sniff mode',
    body: "tap the little moon up top-left — i slip into hunting mode. the streets dim, my nose lifts, and every pet within walking distance peeks at you from the edges of the screen. tap one and we're off.",
  },
  {
    iconName: 'meet',
    title: 'press + hold the map',
    body: "press anywhere on the map and hold — close your eyes for two seconds, i'm sniffing. i'll tell you about an old stone, a courtyard with a secret, a corner with a story. press somewhere else for another one.",
  },
  {
    iconName: 'paws',
    title: 'paws + bones',
    body: "little paws scattered around our streets, bones tucked near parks. i scoop them up as we pass — fills my belly, fluffs my tail, keeps me bouncing alongside you.",
  },
  {
    iconName: 'sun',
    title: 'how i feel',
    body: "the sun up top is how happy i am. the bone is how hungry. the paw print is how many we've gathered together. walking fills them all up — sitting too long, *tail droops*. so let's go.",
  },
  {
    iconName: 'task',
    title: 'today',
    body: "tiny things to chew through each day — find some paws, peek at a pet, visit a place. nothing big. just enough reason to take me out again tomorrow. *eager wag*",
  },
  {
    iconName: 'chat',
    title: 'talk to me',
    body: "anytime. i know our streets, the pets nearby waiting to be found, the old stories kyiv keeps under its windows. worried about your dog or cat? i know enough to help. and i remember every walk we've taken — every single one.",
  },
  {
    iconName: 'pin',
    title: 'places to stop',
    body: "coffee, food, a drink, vets, pet shops. tap any one and we'll trot over together. ask for a round trip and i'll bring you home after — promise.",
  },
  {
    iconName: 'house',
    title: "where we keep things",
    body: "all our walks gather here. how far we've gone, how many paws collected, how many pets we've helped find. we level up together, you and me. paw in hand.",
  },
];

export function AboutModal({ open, onClose }: AboutModalProps) {
  const [rendered, setRendered] = useState(open);
  const [closing, setClosing] = useState(false);

  // Same three-state machine as the other sheets so dismiss animates.
  useEffect(() => {
    if (open) {
      setRendered(true);
      setClosing(false);
      return;
    }
    if (rendered && !closing) {
      setClosing(true);
      const t = setTimeout(() => {
        setRendered(false);
        setClosing(false);
      }, SHEET_ANIM_MS);
      return () => clearTimeout(t);
    }
  }, [open]);

  if (!rendered) return null;

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
        // Reserve the top for the HUD pills and the bottom for the
        // tab dashboard + iPhone home-indicator. Bumped 100→124px
        // because on PWA users reported the rows list slipping
        // under the dashboard — the previous gap was just enough to
        // clear it but visually felt too tight.
        paddingTop: 80,
        paddingBottom: 'calc(124px + env(safe-area-inset-bottom))' as unknown as number,
        zIndex: Z.MODAL_GLOBAL,
        opacity: closing ? 0 : 1,
        transition: `opacity ${SHEET_ANIM_MS}ms ease-out`,
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
          // Cap to the available flex content area (overlay padding
          // already reserves clearance) so the inner rows scroll
          // instead of the sheet pushing past the HUD.
          maxHeight: '100%',
          display: 'flex',
          flexDirection: 'column',
          animation: `sheet-${closing ? 'down' : 'up'} ${SHEET_ANIM_MS}ms cubic-bezier(0.4,0,0.2,1) forwards`,
          boxShadow: '0 -10px 30px rgba(0,0,0,0.12)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 8,
          }}
        >
          <span
            style={{
              background: '#f0f0f0',
              color: '#555',
              borderRadius: 12,
              padding: '4px 10px',
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: 0.3,
              textTransform: 'lowercase',
            }}
          >
            about
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

        <div style={{ marginTop: 4, marginBottom: 14 }}>
          <div style={{ fontFamily: SYSTEM_FONT, fontSize: 22, fontWeight: 700 }}>
            *sniff sniff*
          </div>
          <div style={{ fontSize: 14, color: '#444', marginTop: 6, lineHeight: 1.45 }}>
            привіт! i'm <strong>шукайпес</strong>. we walk, we sniff, we find lost
            pets, we learn this city paw by paw. here's what you'll see on the map:
          </div>
        </div>

        <div
          style={{
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            paddingRight: 4,
          }}
        >
          {ROWS.map((r) => (
            <div key={r.title} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  background: '#f5f5f5',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 18,
                  flexShrink: 0,
                }}
              >
                {r.iconName ? <Icon name={r.iconName} size={38} /> : r.emoji}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: SYSTEM_FONT,
                    fontSize: 15,
                    fontWeight: 700,
                    color: '#1a1a1a',
                  }}
                >
                  {r.title}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: '#555',
                    marginTop: 2,
                    lineHeight: 1.45,
                  }}
                >
                  {r.body}
                </div>
              </div>
            </div>
          ))}
          <div
            style={{
              fontSize: 13,
              color: '#777',
              textAlign: 'center',
              marginTop: 6,
              marginBottom: 4,
              fontStyle: 'italic',
            }}
          >
            *tail wag* — when in doubt, just walk. we'll figure the rest out together. 🐾
          </div>
        </div>

        <style>{`
          @keyframes sheet-up {
            from { transform: translateY(100%); }
            to { transform: translateY(0); }
          }
          @keyframes sheet-down {
            from { transform: translateY(0); }
            to { transform: translateY(100%); }
          }
        `}</style>
      </div>
    </div>
  );
}
