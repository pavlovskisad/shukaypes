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
    body: "the ones with the red glow — somebody's missing them right now. tap one and we go look. i sniff out three spots near where they were last seen, you walk, i wag, we find.",
  },
  {
    iconName: 'eyes',
    title: "if you spot one",
    body: "if you actually see one of these pets out in real life — open their photo and tell me. i'll let everyone else looking know where to look next. that's a real one for the books.",
  },
  {
    iconName: 'search',
    title: 'sniff mode',
    body: 'tap the little moon up top-left when you want to focus. the streets dim down and every missing pet within walking range pops up around the edges of the screen. tap a photo and we head that way.',
  },
  {
    iconName: 'meet',
    title: 'press + hold the map',
    body: "hold your finger on the map anywhere, count to two — i'll sniff around and tell you about a place i know there. some old monument, a courtyard with a story, a corner with a secret. tap again somewhere else for another one.",
  },
  {
    iconName: 'paws',
    title: 'paws + bones',
    body: 'little paws and bones along the way — i scoop them up as we pass. paws turn up around the neighborhood, bones rest near the parks. they keep me fed and bouncy.',
  },
  {
    iconName: 'sun',
    title: 'how i feel',
    body: "the sun up top is how happy i am. the bone is how hungry. the little paw print is what we've picked up together so far. walks fill them up, sitting still lets them drift down — so let's keep going.",
  },
  {
    iconName: 'task',
    title: 'today',
    body: "small things to do each day — a few paws, a pet to check on, a place to visit. nothing serious. just a little reason to take me out tomorrow too.",
  },
  {
    iconName: 'chat',
    title: 'talk to me',
    body: "anytime. i know the streets we walk, the pets nearby waiting to be found, and the old stories kyiv keeps under its windows. if you ever worry about your dog or cat, i know enough to help. and i remember every walk.",
  },
  {
    iconName: 'pin',
    title: 'places to stop',
    body: "coffee, food, a drink, vets, pet shops. tap any one and we'll walk there together. ask for a round trip if you want me to bring you home after.",
  },
  {
    iconName: 'house',
    title: "where we keep things",
    body: "all our walks add up here. how far we went, how many paws we found, how many pets we've helped. we level up together, you and me.",
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
            привіт. i'm <strong>шукайпес</strong>. we walk kyiv together — look for
            lost pets, learn the streets, find a few paws on the way. here's
            everything you'll see on the map:
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
                {r.iconName ? <Icon name={r.iconName} size={22} /> : r.emoji}
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
