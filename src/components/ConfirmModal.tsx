import { useTranslation } from 'react-i18next';
import {
  AlertDialog,
  AlertDialogTrigger,
  Button,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
  type ButtonProps,
} from '../lib/ui';
import { Spinner } from '../lib/ui/components/main/spinner';

interface Props {
  title: string;
  description: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactElement;
  variant?: ButtonProps['variant'];
  cancelText?: string;
  confirmText?: string;
  open?: boolean;
  loading?: boolean;
}

const ConfirmModal = ({
  title,
  description,
  onConfirm,
  onCancel,
  children,
  variant,
  cancelText,
  confirmText,
  open,
  loading,
}: Props) => {
  const { t } = useTranslation('common');
  return (
    <AlertDialog open={open}>
      {open === undefined && children ? (
        <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      ) : null}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel} disabled={loading}>
            {cancelText ?? t('cancel')}
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button
              variant={variant}
              className="gap-2 text-white"
              onClick={onConfirm}
              disabled={loading}
            >
              {loading && <Spinner className="size-3.5 fill-white text-white/30" />}
              {confirmText ?? t('confirm')}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default ConfirmModal;
