import { HugeiconsIcon } from '@hugeicons/react';
import type { HugeiconsProps, IconSvgElement } from '@hugeicons/react';
import {
  Sun03Icon,
  Sun01Icon,
  SunCloud02Icon,
  Remove01Icon,
  CenterFocusIcon,
  Add01Icon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowDataTransferHorizontalIcon,
  EaseCurveControlPointsIcon,
  Cancel01Icon,
  ComputerVideoIcon,
  CropIcon,
  Shield01Icon,
  SearchAddIcon,
  Cursor01Icon,
  Delete02Icon,
  ViewIcon,
  FolderOpenIcon,
  Home03Icon,
  Image01Icon,
  CommandIcon,
  KeyboardIcon,
  LayoutGridIcon,
  ListViewIcon,
  MagnetIcon,
  Mic01Icon,
  MicOff01Icon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  RecordIcon,
  RedoIcon,
  SaveIcon,
  ScanEyeIcon,
  ScissorIcon,
  StopIcon,
  Tick02Icon,
  UndoIcon,
  Upload01Icon,
  Video01Icon,
  VideoOffIcon,
  ViewOffIcon,
  WindowsNewIcon,
  ZoomInAreaIcon,
  ZoomOutAreaIcon,
  AiMagicIcon,
  BlurIcon,
  LibraryIcon,
  Folder01Icon,
  MoreHorizontalIcon,
  MoreVerticalIcon,
  LoadingIcon,
  ClosedCaptionIcon,
  ChipIcon,
  InformationCircleIcon,
  FileScriptIcon,
  ArrowReloadHorizontalIcon,
  TextIcon,
  TextBoldIcon,
  TextItalicIcon,
  TextUnderlineIcon,
  TextAlignLeftIcon,
  TextAlignCenterIcon,
  TextAlignRightIcon,
  AlignTopIcon,
  AlignVerticalCenterIcon,
  AlignBottomIcon,
  Film02Icon,
  QuotesIcon,
  Note01Icon,
  FavouriteIcon,
  Megaphone01Icon,
  ChatFeedbackIcon,
  Settings01Icon,
  LogoutSquare01Icon,
  UserAccountIcon,
  GlobeIcon,
  Camera01Icon,
  MusicNote01Icon,
  FileMusicIcon,
  MusicThreeIcon,
  Timer02Icon,
  Layers01Icon,
  Coffee01Icon,
  ArrowUpRight01Icon,
  SquareIcon,
  HighlighterIcon,
  HashtagIcon,
  Copy01Icon,
  Download01Icon,
  // @ts-expect-error hugeicons free icon exports are not fully represented in the package types.
} from '@hugeicons/core-free-icons';
import { forwardRef } from 'react';

type CompatIconProps = Omit<HugeiconsProps, 'icon' | 'size' | 'strokeWidth'> & {
  size?: number | string;
  stroke?: number;
};

function createIcon(icon: IconSvgElement, displayName: string) {
  const Component = forwardRef<SVGSVGElement, CompatIconProps>(
    ({ size = 24, stroke = 1.5, color = 'currentColor', ...props }, ref) => (
      <HugeiconsIcon
        ref={ref}
        icon={icon}
        size={size}
        strokeWidth={stroke}
        color={color}
        {...props}
      />
    ),
  );

  Component.displayName = displayName;

  return Component;
}

export const IconAppWindow = createIcon(WindowsNewIcon, 'IconAppWindow');
export const IconArrowBackUp = createIcon(UndoIcon, 'IconArrowBackUp');
export const IconArrowForwardUp = createIcon(RedoIcon, 'IconArrowForwardUp');
export const IconCheck = createIcon(Tick02Icon, 'IconCheck');
export const IconChevronDown = createIcon(ArrowDown01Icon, 'IconChevronDown');
export const IconChevronLeft = createIcon(ArrowLeft01Icon, 'IconChevronLeft');
export const IconChevronRight = createIcon(ArrowRight01Icon, 'IconChevronRight');
export const IconMotion = createIcon(EaseCurveControlPointsIcon, 'IconMotion');
export const IconSwap = createIcon(ArrowDataTransferHorizontalIcon, 'IconSwap');
export const IconCrop = createIcon(CropIcon, 'IconCrop');
export const IconDeviceDesktop = createIcon(ComputerVideoIcon, 'IconDeviceDesktop');
export const IconDeviceFloppy = createIcon(SaveIcon, 'IconDeviceFloppy');
export const IconEye = createIcon(ViewIcon, 'IconEye');
export const IconEyeOff = createIcon(ViewOffIcon, 'IconEyeOff');
export const IconFolderOpen = createIcon(FolderOpenIcon, 'IconFolderOpen');
export const IconHome = createIcon(Home03Icon, 'IconHome');
export const IconCommand = createIcon(CommandIcon, 'IconCommand');
export const IconKeyboard = createIcon(KeyboardIcon, 'IconKeyboard');
export const IconLayoutGrid = createIcon(LayoutGridIcon, 'IconLayoutGrid');
export const IconLayoutList = createIcon(ListViewIcon, 'IconLayoutList');
export const IconMagnet = createIcon(MagnetIcon, 'IconMagnet');
export const IconMicrophone = createIcon(Mic01Icon, 'IconMicrophone');
export const IconMicrophoneOff = createIcon(MicOff01Icon, 'IconMicrophoneOff');
export const IconPencil = createIcon(PencilIcon, 'IconPencil');
export const IconPhoto = createIcon(Image01Icon, 'IconPhoto');
export const IconPlayerPauseFilled = createIcon(PauseIcon, 'IconPlayerPauseFilled');
export const IconPlayerPlayFilled = createIcon(PlayIcon, 'IconPlayerPlayFilled');
export const IconPlayerRecord = createIcon(RecordIcon, 'IconPlayerRecord');
export const IconPlayerRecordFilled = createIcon(RecordIcon, 'IconPlayerRecordFilled');
export const IconPlayerStopFilled = createIcon(StopIcon, 'IconPlayerStopFilled');
export const IconPlus = createIcon(Add01Icon, 'IconPlus');
export const IconPointer = createIcon(Cursor01Icon, 'IconPointer');
export const IconScissors = createIcon(ScissorIcon, 'IconScissors');
export const IconTrash = createIcon(Delete02Icon, 'IconTrash');
export const IconUpload = createIcon(Upload01Icon, 'IconUpload');
export const IconVideo = createIcon(Video01Icon, 'IconVideo');
export const IconVideoOff = createIcon(VideoOffIcon, 'IconVideoOff');
export const IconX = createIcon(Cancel01Icon, 'IconX');
export const IconZoom = createIcon(SearchAddIcon, 'IconZoom');
export const IconZoomIn = createIcon(ZoomInAreaIcon, 'IconZoomIn');
export const IconZoomOut = createIcon(ZoomOutAreaIcon, 'IconZoomOut');
export const IconZoomScan = createIcon(ScanEyeIcon, 'IconZoomScan');
export const IconAiMagic = createIcon(AiMagicIcon, 'IconAiMagic');
export const IconLibrary = createIcon(LibraryIcon, 'IconLibrary');
export const IconFolder = createIcon(Folder01Icon, 'IconFolder');
export const IconMoreHorizontal = createIcon(MoreHorizontalIcon, 'IconMoreHorizontal');
export const IconMoreVertical = createIcon(MoreVerticalIcon, 'IconMoreVertical');
export const IconLoading = createIcon(LoadingIcon, 'IconLoading');
export const IconCaptions = createIcon(ClosedCaptionIcon, 'IconCaptions');
export const IconChip = createIcon(ChipIcon, 'IconChip');
export const IconInfo = createIcon(InformationCircleIcon, 'IconInfo');
export const IconScript = createIcon(FileScriptIcon, 'IconScript');
export const IconRestart = createIcon(ArrowReloadHorizontalIcon, 'IconRestart');
export const IconText = createIcon(TextIcon, 'IconText');
export const IconTextBold = createIcon(TextBoldIcon, 'IconTextBold');
export const IconTextItalic = createIcon(TextItalicIcon, 'IconTextItalic');
export const IconTextUnderline = createIcon(TextUnderlineIcon, 'IconTextUnderline');
export const IconAlignLeft = createIcon(TextAlignLeftIcon, 'IconAlignLeft');
export const IconAlignCenter = createIcon(TextAlignCenterIcon, 'IconAlignCenter');
export const IconAlignRight = createIcon(TextAlignRightIcon, 'IconAlignRight');
export const IconAlignTop = createIcon(AlignTopIcon, 'IconAlignTop');
export const IconAlignMiddle = createIcon(AlignVerticalCenterIcon, 'IconAlignMiddle');
export const IconAlignBottom = createIcon(AlignBottomIcon, 'IconAlignBottom');
export const IconFilm = createIcon(Film02Icon, 'IconFilm');
export const IconQuote = createIcon(QuotesIcon, 'IconQuote');
export const IconNote = createIcon(Note01Icon, 'IconNote');
export const IconHeart = createIcon(FavouriteIcon, 'IconHeart');
export const IconMegaphone = createIcon(Megaphone01Icon, 'IconMegaphone');
export const IconChatFeedback = createIcon(ChatFeedbackIcon, 'IconChatFeedback');
export const IconSettings = createIcon(Settings01Icon, 'IconSettings');
export const IconLogoutSquare = createIcon(LogoutSquare01Icon, 'IconLogoutSquare');
export const IconUserAccount = createIcon(UserAccountIcon, 'IconUserAccount');
export const IconGlobe = createIcon(GlobeIcon, 'IconGlobe');
export const IconShield = createIcon(Shield01Icon, 'IconShield');
export const IconBlur = createIcon(BlurIcon, 'IconBlur');
export const IconCamera = createIcon(Camera01Icon, 'IconCamera');
export const IconMusicNote = createIcon(MusicNote01Icon, 'IconMusicNote');
export const IconFileMusic = createIcon(FileMusicIcon, 'IconFileMusic');
export const IconMusic3 = createIcon(MusicThreeIcon, 'IconMusic3');
export const IconTimer = createIcon(Timer02Icon, 'IconTimer');
export const IconLayers = createIcon(Layers01Icon, 'IconLayers');
export const IconCoffee = createIcon(Coffee01Icon, 'IconCoffee');
export const IconArrowUpRight = createIcon(ArrowUpRight01Icon, 'IconArrowUpRight');
export const IconSquare = createIcon(SquareIcon, 'IconSquare');
export const IconHighlighter = createIcon(HighlighterIcon, 'IconHighlighter');
export const IconHash = createIcon(HashtagIcon, 'IconHash');
export const IconCopy = createIcon(Copy01Icon, 'IconCopy');
export const IconDownload = createIcon(Download01Icon, 'IconDownload');

export type { CompatIconProps };
export const IconSun = createIcon(Sun03Icon, 'IconSun');
export const IconMinus = createIcon(Remove01Icon, 'IconMinus');
export const IconFocusPoint = createIcon(CenterFocusIcon, 'IconFocusPoint');
export const IconSunSoft = createIcon(SunCloud02Icon, 'IconSunSoft');
export const IconSunCrisp = createIcon(Sun01Icon, 'IconSunCrisp');
