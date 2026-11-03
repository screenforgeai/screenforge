import * as Sentry from '@sentry/electron/renderer';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { trackEvent } from 'src/lib/analytics';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Switch,
  SwitchThumb,
} from '../../../lib/ui';
import type { WidgetTab } from '../../../store';
import { IconHeart, IconX } from 'src/lib/icons';

const KOFI_URL = 'https://ko-fi.com/mohibarshi';

const MIN_MESSAGE_LENGTH = 10;

type FeedbackReportType = 'bug' | 'idea' | 'help';

type FeedbackModalProps = {
  open: boolean;
  activeWidget: WidgetTab;
  onClose: () => void;
  customTitle?: string;
  customDescription?: string;
  source?: string;
  showKofiAfterSubmit?: boolean;
};

const FEEDBACK_TYPE_CLASSES: Record<FeedbackReportType, string> = {
  bug: 'bg-[#FDEBEC] text-[#9F2F2D]',
  idea: 'bg-[#E1F3FE] text-[#1F6C9F]',
  help: 'bg-[#EDF3EC] text-[#346538]',
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return '';
}

async function getFeedbackContext(activeWidget: WidgetTab) {
  const appVersion = await window.screenforge.getAppVersion().catch(() => 'unknown');
  return {
    app_version: appVersion,
    active_widget: activeWidget,
    route: window.location.hash || 'main',
    platform: navigator.platform,
    user_agent: navigator.userAgent,
  };
}

export const FeedbackModal = ({
  open,
  activeWidget,
  onClose,
  customTitle,
  customDescription,
  source = 'widget_library_feedback_modal',
  showKofiAfterSubmit = false,
}: FeedbackModalProps) => {
  const { t } = useTranslation('feedback');
  const feedbackTypes: { id: FeedbackReportType; label: string; description: string }[] = [
    { id: 'bug', label: t('bugLabel'), description: t('bugDesc') },
    { id: 'idea', label: t('ideaLabel'), description: t('ideaDesc') },
    { id: 'help', label: t('helpLabel'), description: t('helpDesc') },
  ];
  const [step, setStep] = useState<'form' | 'kofi'>('form');
  const [reportType, setReportType] = useState<FeedbackReportType>('bug');
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [shareLogs, setShareLogs] = useState(true);

  useEffect(() => {
    if (open) {
      window.screenforge.getSettings().then((s) => {
        setName(s.profile.name);
        setEmail(s.profile.email);
      });
    }
  }, [open]);

  const selectedType = feedbackTypes.find((item) => item.id === reportType) ?? feedbackTypes[0];

  const resetForm = () => {
    setStep('form');
    setReportType('bug');
    setMessage('');
    setName('');
    setEmail('');
    setErrorText('');
    setShareLogs(true);
  };

  const handleClose = () => {
    if (submitting) {
      return;
    }
    resetForm();
    onClose();
  };

  const handleKofiClick = () => {
    trackEvent('kofi_clicked', { source });
    window.screenforge.openExternalUrl(KOFI_URL);
    resetForm();
    onClose();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedMessage = message.trim();
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();

    if (trimmedMessage.length < MIN_MESSAGE_LENGTH) {
      setErrorText(t('errorTooShort'));
      return;
    }

    setSubmitting(true);
    setErrorText('');
    trackEvent('feedback_submit_started', {
      report_type: reportType,
      active_widget: activeWidget,
    });

    try {
      const context = await getFeedbackContext(activeWidget);
      const logContent =
        reportType === 'bug' && shareLogs
          ? await window.screenforge.readLogFile().catch(() => '')
          : '';

      Sentry.withScope((scope) => {
        scope.setContext('screenforge_feedback', {
          ...context,
          report_type: reportType,
          logs_attached: logContent.length > 0,
        });

        return Sentry.captureFeedback(
          {
            message: trimmedMessage,
            name: trimmedName,
            email: trimmedEmail,
            source,
            tags: {
              screenforge_report_type: reportType,
              screenforge_active_widget: activeWidget,
            },
          },
          {
            includeReplay: false,
            attachments: logContent
              ? [{ filename: 'screenforge.log', data: logContent, contentType: 'text/plain' }]
              : [],
          },
        );
      });

      if (trimmedName || trimmedEmail) {
        void window.screenforge.saveSettings({
          profile: { name: trimmedName, email: trimmedEmail },
        });
        window.screenforge.identifyUser({
          name: trimmedName || undefined,
          email: trimmedEmail || undefined,
        });
      }
      toast.success(t('toastSuccess'));
      resetForm();
      if (showKofiAfterSubmit) {
        setStep('kofi');
      } else {
        onClose();
      }
      trackEvent('feedback_submitted', {
        report_type: reportType,
        active_widget: activeWidget,
        share_logs: reportType === 'bug' && shareLogs,
      });
    } catch (error) {
      const message = getErrorMessage(error) || t('errorSendFailed');
      setErrorText(message);
      toast.error(message);
      trackEvent('feedback_submit_failed', {
        report_type: reportType,
        active_widget: activeWidget,
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (step === 'kofi') {
    return (
      <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && handleClose()}>
        <DialogContent
          showCloseButton={false}
          className="max-w-sm gap-0 overflow-hidden rounded-lg border-sf-border bg-sf-bg p-0 shadow-none"
        >
          <DialogHeader className="gap-0 border-b border-sf-border/70 px-6 py-5">
            <div className="flex items-center justify-between">
              <DialogTitle className="flex items-center gap-1.5 text-lg font-semibold tracking-tight text-sf-primary">
                <IconHeart size={16} className="shrink-0 text-sf-red" />
                {t('kofi_title')}
              </DialogTitle>
              <Button type="button" variant="ghost" size="icon-sm" onClick={handleClose}>
                <IconX size={14} />
              </Button>
            </div>
          </DialogHeader>

          <div className="px-6 py-4">
            <DialogDescription className="text-sm leading-relaxed text-sf-secondary">
              {t('kofi_body')}
            </DialogDescription>
          </div>

          <DialogFooter className="items-center justify-end border-t border-sf-border/60 px-6 py-4">
            <div className="flex shrink-0 items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={handleClose}>
                {t('kofi_dismiss')}
              </Button>
              <Button
                type="button"
                size="sm"
                className="gap-1.5 shadow-none transition-transform active:scale-[0.98]"
                onClick={handleKofiClick}
              >
                <IconHeart size={13} className="text-sf-red" />
                {t('kofi_cta')}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

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
                  {customTitle ?? t('title')}
                </DialogTitle>
                <DialogDescription className="max-w-[30rem] text-md text-sf-secondary">
                  {customDescription ?? t('subtitle')}
                </DialogDescription>
              </div>

              <Button type="button" variant="ghost" size="icon-sm" onClick={onClose}>
                <IconX size={14} />
              </Button>
            </div>
          </DialogHeader>

          <div className="grid gap-5 px-6 py-5">
            <div className="grid gap-2">
              <label className="text-sm font-medium text-sf-primary">{t('reportType')}</label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr]">
                {feedbackTypes.map((item) => {
                  const selected = item.id === reportType;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={selected}
                      className={`cursor-pointer flex flex-col gap-2 rounded-md border px-3 py-3 text-left transition-[border-color,background-color,transform] duration-150 active:scale-[0.98] ${
                        selected
                          ? 'border-sf-border-lt bg-[#19191f] text-sf-primary'
                          : 'border-sf-border bg-[#111116] text-sf-secondary hover:border-sf-border-lt hover:bg-[#15151b]'
                      }`}
                      onClick={() => {
                        setReportType(item.id);
                        setErrorText('');
                      }}
                    >
                      <span
                        className={`inline-flex w-max rounded-full px-2 py-0.5 text-2xs font-medium uppercase tracking-widest ${FEEDBACK_TYPE_CLASSES[item.id]}`}
                      >
                        {item.label}
                      </span>
                      <span className="text-xs leading-4 text-sf-secondary">
                        {item.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input
                id="feedback-name"
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
                id="feedback-email"
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

            <div className="grid gap-2">
              <label htmlFor="feedback-message" className="text-sm font-medium text-sf-primary">
                {t('details')}
              </label>
              <textarea
                id="feedback-message"
                value={message}
                disabled={submitting}
                aria-invalid={Boolean(errorText)}
                className="min-h-28 w-full resize-none rounded-md border border-sf-border bg-[#111116] px-3 py-2 text-sm leading-5 text-sf-primary outline-none transition-[border-color,box-shadow] placeholder:text-sf-muted focus:border-primary focus:ring-2 focus:ring-white/5 disabled:cursor-not-allowed disabled:opacity-60"
                placeholder={t('detailsPlaceholder', { type: selectedType.label.toLowerCase() })}
                onChange={(event) => {
                  setMessage(event.target.value);
                  setErrorText('');
                }}
              />
              {errorText && <p className="text-xs leading-4 text-[#ffb4bd]">{errorText}</p>}
            </div>

            <div
              className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
                reportType === 'bug'
                  ? 'grid-rows-[1fr] opacity-100'
                  : 'grid-rows-[0fr] opacity-0 pointer-events-none'
              }`}
            >
              <div className="overflow-hidden">
                <label
                  htmlFor="share-logs"
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-sf-border/50 bg-[#111116] px-3 py-2.5 transition-colors hover:border-sf-border-lt hover:bg-[#15151b]"
                >
                  <div className="grid gap-0.5">
                    <span className="text-sm font-medium leading-none text-sf-primary">
                      {t('shareLogs_label')}
                    </span>
                    <span className="text-xs leading-4 text-sf-muted">{t('shareLogs_desc')}</span>
                  </div>
                  <Switch
                    id="share-logs"
                    size="xs"
                    checked={shareLogs}
                    disabled={submitting}
                    onCheckedChange={setShareLogs}
                    className="shrink-0"
                  >
                    <SwitchThumb />
                  </Switch>
                </label>
              </div>
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
                {t('cancel')}
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={submitting}
                className="shadow-none transition-transform active:scale-[0.98]"
              >
                {submitting ? t('sending') : t('sendReport')}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
