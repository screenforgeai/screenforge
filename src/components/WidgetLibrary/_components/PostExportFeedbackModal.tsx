import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { submitFeedback, trackEvent } from 'src/lib/analytics';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '../../../lib/ui';
import { IconX } from 'src/lib/icons';

type PostExportFeedbackModalProps = {
  open: boolean;
  onClose: () => void;
};

export const PostExportFeedbackModal = ({ open, onClose }: PostExportFeedbackModalProps) => {
  const { t } = useTranslation('feedback');
  const STAR_LABELS = [
    t('star_poor'),
    t('star_fair'),
    t('star_good'),
    t('star_great'),
    t('star_loveIt'),
  ];
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [comment, setComment] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState('');

  useEffect(() => {
    if (open) {
      window.screenforge.getSettings().then((s) => {
        setName(s.profile.name);
        setEmail(s.profile.email);
      });
    }
  }, [open]);

  const resetForm = () => {
    setRating(0);
    setHovered(0);
    setComment('');
    setName('');
    setEmail('');
    setErrorText('');
  };

  const handleClose = () => {
    if (submitting) {
      return;
    }
    resetForm();
    onClose();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (rating === 0) {
      setErrorText(t('error_noRating'));
      return;
    }

    if (!name.trim()) {
      setErrorText(t('error_noName'));
      return;
    }

    if (!email.trim()) {
      setErrorText(t('error_noEmail'));
      return;
    }

    setSubmitting(true);
    setErrorText('');
    trackEvent('first_export_feedback_submit_started', { rating });

    try {
      const appVersion = await window.screenforge.getAppVersion().catch(() => 'unknown');

      submitFeedback({
        message: comment.trim() || `Rating: ${rating}/5 — ${STAR_LABELS[rating - 1]}`,
        name: name.trim(),
        email: email.trim(),
        source: 'first_export_feedback_modal',
        reportType: 'first_export',
        rating,
        context: {
          app_version: appVersion,
          route: window.location.hash || 'main',
          platform: navigator.platform,
          user_agent: navigator.userAgent,
        },
      });

      const trimmedName = name.trim();
      const trimmedEmail = email.trim();
      void window.screenforge.saveSettings({ profile: { name: trimmedName, email: trimmedEmail } });
      window.screenforge.identifyUser({
        name: trimmedName || undefined,
        email: trimmedEmail || undefined,
      });
      toast.success(t('toastSuccess'));
      resetForm();
      onClose();
      trackEvent('first_export_feedback_submitted', { rating });
    } catch {
      const msg = t('errorSendFailed');
      setErrorText(msg);
      toast.error(msg);
      trackEvent('first_export_feedback_submit_failed', { rating });
    } finally {
      setSubmitting(false);
    }
  };

  const displayRating = hovered || rating;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && handleClose()}>
      <DialogContent
        showCloseButton={false}
        className="max-w-[36rem] gap-0 overflow-hidden rounded-lg border-sf-border bg-sf-bg p-0 shadow-none"
      >
        <form onSubmit={handleSubmit}>
          <DialogHeader className="border-b border-sf-border/70 px-6 py-5 gap-0">
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="text-lg font-semibold tracking-tight text-sf-primary">
                  {t('firstExport_title')}
                </DialogTitle>
                <DialogDescription className="max-w-[30rem] text-md text-sf-secondary">
                  {t('firstExport_subtitle')}
                </DialogDescription>
              </div>
              <Button type="button" variant="ghost" size="icon-sm" onClick={handleClose}>
                <IconX size={14} />
              </Button>
            </div>
          </DialogHeader>

          <div className="grid gap-5 px-6 py-5">
            {/* Star rating */}
            <div className="grid gap-2">
              <label className="text-sm font-medium text-sf-primary">
                {t('firstExport_ratingLabel')}
              </label>
              <div className="flex items-center gap-1" onMouseLeave={() => setHovered(0)}>
                {STAR_LABELS.map((label, idx) => {
                  const value = idx + 1;
                  const filled = value <= displayRating;
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-label={label}
                      title={label}
                      className={`text-2xl leading-none transition-colors duration-100 ${
                        filled ? 'text-amber-400' : 'text-sf-border hover:text-amber-300'
                      }`}
                      onMouseEnter={() => setHovered(value)}
                      onClick={() => {
                        setRating(value);
                        setErrorText('');
                      }}
                    >
                      {filled ? '★' : '☆'}
                    </button>
                  );
                })}
                {displayRating > 0 && (
                  <span className="ml-2 text-sm text-sf-secondary">
                    {STAR_LABELS[displayRating - 1]}
                  </span>
                )}
              </div>
              {errorText && <p className="text-xs leading-4 text-[#ffb4bd]">{errorText}</p>}
            </div>

            {/* Optional comment */}
            <div className="grid gap-2">
              <label htmlFor="first-export-comment" className="text-sm font-medium text-sf-primary">
                {t('firstExport_commentLabel')}
              </label>
              <textarea
                id="first-export-comment"
                value={comment}
                disabled={submitting}
                className="min-h-20 w-full resize-none rounded-md border border-sf-border bg-[#111116] px-3 py-2 text-sm leading-5 text-sf-primary outline-none transition-[border-color,box-shadow] placeholder:text-sf-muted focus:border-primary focus:ring-2 focus:ring-white/5 disabled:cursor-not-allowed disabled:opacity-60"
                placeholder={t('firstExport_commentPlaceholder')}
                onChange={(event) => setComment(event.target.value)}
              />
            </div>

            {/* Name + email */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input
                id="first-export-name"
                label={t('name')}
                value={name}
                required
                disabled={submitting}
                className="h-9"
                labelProps={{ className: 'text-sf-primary' }}
                placeholder={t('namePlaceholder')}
                onChange={(event) => setName(event.target.value)}
              />
              <Input
                id="first-export-email"
                type="email"
                label={t('email')}
                value={email}
                required
                disabled={submitting}
                className="h-9"
                labelProps={{ className: 'text-sf-primary' }}
                placeholder={t('emailPlaceholder')}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
          </div>

          <DialogFooter className="items-center justify-end border-t border-sf-border/60 px-6 py-4">
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={submitting}
                onClick={handleClose}
              >
                {t('firstExport_skip')}
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={submitting || !name.trim() || !email.trim()}
                className="shadow-none transition-transform active:scale-[0.98]"
              >
                {submitting ? t('sending') : t('firstExport_submit')}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
