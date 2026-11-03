import { useTranslation } from 'react-i18next';
import { trackEvent } from 'src/lib/analytics';
import { Button, Dialog, DialogClose, DialogContent } from '../../../lib/ui';
import { IconCoffee, IconX } from 'src/lib/icons';

const KOFI_URL = 'https://ko-fi.com/mohibarshi';

const MILESTONE_DESCRIPTIONS = [
  "Screenforge has no subscription, no feature gates. If it's saved you time, a coffee on Ko-fi helps keep it alive and growing.",
  'You keep coming back — that genuinely means a lot. If Screenforge has been useful, a coffee on Ko-fi helps me keep shipping improvements.',
  "You've been using Screenforge for a while now. I build this solo in my free time. A coffee on Ko-fi would go a long way.",
  "You're a power user — it means everything. If you've gotten real value from Screenforge, a coffee on Ko-fi would genuinely make my day.",
];

type KofiModalProps = {
  open: boolean;
  milestoneNumber: number;
  onClose: () => void;
};

export const KofiModal = ({ open, milestoneNumber, onClose }: KofiModalProps) => {
  const { t } = useTranslation('feedback');

  const descriptionIndex = Math.min(milestoneNumber - 1, MILESTONE_DESCRIPTIONS.length - 1);
  const description = MILESTONE_DESCRIPTIONS[descriptionIndex];

  const handleKofiClick = () => {
    trackEvent('kofi_clicked', { source: 'milestone_kofi_modal', milestone: milestoneNumber });
    window.screenforge.openExternalUrl(KOFI_URL);
    onClose();
  };

  const handleDismiss = () => {
    trackEvent('kofi_modal_dismissed', { milestone: milestoneNumber });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && handleDismiss()}>
      <DialogContent
        showCloseButton={false}
        className="max-w-sm sm:max-w-sm gap-0 overflow-hidden rounded-2xl border-[0.5px] border-white/7 bg-[#141414] p-0 shadow-none"
      >
        {/* Illustration banner */}
        <div className="relative h-[210px] w-full overflow-hidden bg-[#111]">
          <svg
            viewBox="0 0 380 210"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="absolute inset-0 h-full w-full"
            aria-hidden="true"
          >
            <defs>
              <linearGradient
                id="bgBase"
                x1="0"
                y1="0"
                x2="0"
                y2="210"
                gradientUnits="userSpaceOnUse"
              >
                <stop offset="0%" stopColor="#100e0d" />
                <stop offset="100%" stopColor="#131110" />
              </linearGradient>
              <linearGradient
                id="fade"
                x1="0"
                y1="155"
                x2="0"
                y2="210"
                gradientUnits="userSpaceOnUse"
              >
                <stop offset="0%" stopColor="#131110" stopOpacity="0" />
                <stop offset="100%" stopColor="#141414" stopOpacity="1" />
              </linearGradient>
              <linearGradient
                id="topFade"
                x1="0"
                y1="0"
                x2="0"
                y2="28"
                gradientUnits="userSpaceOnUse"
              >
                <stop offset="0%" stopColor="#100e0d" stopOpacity="1" />
                <stop offset="100%" stopColor="#100e0d" stopOpacity="0" />
              </linearGradient>
            </defs>

            <rect width="380" height="210" fill="url(#bgBase)" />

            {/* desk surface */}
            <rect x="30" y="148" width="320" height="6" rx="2" fill="#1c1715" />
            <rect x="30" y="153" width="320" height="2" rx="1" fill="#161312" />

            {/* desk legs */}
            <rect x="48" y="154" width="5" height="30" rx="1.5" fill="#181413" />
            <rect x="327" y="154" width="5" height="30" rx="1.5" fill="#181413" />

            {/* monitor stand base */}
            <rect x="174" y="140" width="32" height="5" rx="2" fill="#1c1614" />
            {/* monitor stand neck */}
            <rect x="187" y="126" width="6" height="16" rx="2" fill="#1c1614" />
            {/* monitor bezel outer */}
            <rect x="108" y="52" width="164" height="92" rx="7" fill="#1e1815" />
            {/* monitor bezel inner */}
            <rect x="113" y="57" width="154" height="80" rx="5" fill="#0e0c0b" />
            {/* screen */}
            <rect x="116" y="60" width="148" height="74" rx="3" fill="#0a0908" />

            {/* screen content lines */}
            <rect x="124" y="72" width="62" height="3" rx="1.5" fill="rgba(255,255,255,0.07)" />
            <rect x="124" y="79" width="88" height="3" rx="1.5" fill="rgba(255,255,255,0.05)" />
            <rect x="124" y="86" width="44" height="3" rx="1.5" fill="rgba(255,255,255,0.05)" />
            <rect x="124" y="93" width="72" height="3" rx="1.5" fill="rgba(255,255,255,0.04)" />
            <rect x="124" y="100" width="54" height="3" rx="1.5" fill="rgba(255,255,255,0.04)" />
            <rect x="124" y="107" width="78" height="3" rx="1.5" fill="rgba(255,255,255,0.04)" />
            <rect x="124" y="114" width="36" height="3" rx="1.5" fill="rgba(255,255,255,0.03)" />
            <rect x="124" y="121" width="60" height="3" rx="1.5" fill="rgba(255,255,255,0.03)" />
            <rect x="132" y="79" width="48" height="2.5" rx="1" fill="rgba(255,255,255,0.04)" />
            <rect x="132" y="86" width="28" height="2.5" rx="1" fill="rgba(255,255,255,0.03)" />
            {/* cursor blink — primary accent */}
            <rect x="186" y="100" width="2" height="10" rx="1" fill="rgba(212,69,35,0.35)" />

            {/* coffee cup */}
            <rect x="62" y="122" width="28" height="24" rx="4" fill="#1a1512" />
            <rect x="62" y="122" width="28" height="7" rx="4" fill="#201a16" />
            <path
              d="M90 128 Q97 128 97 134 Q97 140 90 140"
              stroke="#1a1512"
              strokeWidth="2.5"
              fill="none"
              strokeLinecap="round"
            />
            <rect x="64" y="129" width="24" height="2" rx="1" fill="rgba(255,255,255,0.04)" />
            <path
              d="M71 120 Q73 116 71 112"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth="1"
              strokeLinecap="round"
              fill="none"
            />
            <path
              d="M76 119 Q78 114 76 110"
              stroke="rgba(255,255,255,0.06)"
              strokeWidth="1"
              strokeLinecap="round"
              fill="none"
            />
            <path
              d="M81 120 Q83 116 81 112"
              stroke="rgba(255,255,255,0.05)"
              strokeWidth="1"
              strokeLinecap="round"
              fill="none"
            />

            {/* plant */}
            <path d="M285 148 L291 125 L307 125 L313 148 Z" fill="#1a1512" />
            <rect x="283" y="148" width="32" height="4" rx="1" fill="#201a16" />
            <rect x="292" y="126" width="14" height="4" rx="1" fill="#141210" />
            <line
              x1="299"
              y1="127"
              x2="299"
              y2="108"
              stroke="#232018"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <line
              x1="299"
              y1="118"
              x2="292"
              y2="112"
              stroke="#232018"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
            <line
              x1="299"
              y1="113"
              x2="306"
              y2="107"
              stroke="#232018"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
            <ellipse
              cx="295"
              cy="110"
              rx="5"
              ry="3"
              transform="rotate(-30 295 110)"
              fill="#1e1c14"
            />
            <ellipse
              cx="307"
              cy="105"
              rx="5"
              ry="3"
              transform="rotate(25 307 105)"
              fill="#1e1c14"
            />
            <ellipse
              cx="299"
              cy="106"
              rx="4"
              ry="2.5"
              transform="rotate(-5 299 106)"
              fill="#222016"
            />

            {/* notebook */}
            <rect x="34" y="130" width="22" height="18" rx="2" fill="#191614" />
            <rect x="34" y="130" width="4" height="18" rx="1" fill="#201a17" />
            <rect x="40" y="134" width="12" height="1.5" rx="0.75" fill="rgba(255,255,255,0.05)" />
            <rect x="40" y="138" width="10" height="1.5" rx="0.75" fill="rgba(255,255,255,0.04)" />
            <rect x="40" y="142" width="13" height="1.5" rx="0.75" fill="rgba(255,255,255,0.04)" />

            {/* bottom fade */}
            <rect width="380" height="210" fill="url(#fade)" />
            {/* top fade */}
            <rect width="380" height="28" fill="url(#topFade)" />
          </svg>

          {/* Close button overlaid on illustration */}
          <DialogClose asChild onClick={handleDismiss}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Close"
              className="absolute right-2 top-2 z-10"
            >
              <IconX size={14} />
            </Button>
          </DialogClose>
        </div>

        {/* Body */}
        <div className="px-7 pb-6 pt-[1.6rem]">
          <p className="mb-2 whitespace-pre-line text-[18px] font-medium leading-snug tracking-tight text-[#ede9e4]">
            {t('kofi_headline')}
          </p>
          <p className="mb-6 text-[13px] leading-relaxed text-white/32">{description}</p>

          <Button
            type="button"
            size="md"
            className="mb-[0.85rem] w-full gap-2 shadow-none"
            onClick={handleKofiClick}
          >
            <IconCoffee size={15} stroke={1.5} />
            {t('kofi_cta')}
          </Button>

          <p className="text-center text-[11px] text-white/18">{t('kofi_footer_note')}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
};
