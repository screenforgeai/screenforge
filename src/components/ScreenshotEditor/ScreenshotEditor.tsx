import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useHotkeys } from 'react-hotkeys-hook';
import { toast } from 'sonner';
import {
  DEFAULT_BACKGROUND,
  getContainRect,
  preloadCustomWallpaperAsync,
  preloadWallpapersAsync,
} from 'src/lib/effects/frame';
import {
  ANNOTATION_COLORS,
  annotationsReducer,
  createInitialAnnotationsState,
  createShapeFromDrag,
  createStepShape,
  findShapeAt,
  getAnnotationScale,
  getDefaultFontSize,
  resolveTextEdit,
  translateShape,
  type AnnotationShape,
  type AnnotationTool,
  type DragShapeType,
  type Point,
  type TextEdit,
} from 'src/lib/screenshot/annotations';
import {
  canvasPointFromImage,
  clientToCanvasPoint,
  getScreenshotGeometry,
  imagePointFromCanvas,
  renderScreenshot,
  type ScreenshotStyle,
} from 'src/lib/screenshot/compose';
import { trackEvent } from 'src/lib/analytics';
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconArrowUpRight,
  IconBlur,
  IconCopy,
  IconDownload,
  IconHash,
  IconHighlighter,
  IconPointer,
  IconSquare,
  IconText,
  IconTrash,
  IconX,
} from 'src/lib/icons';
import { Button, Tooltip, TooltipContent, TooltipTrigger } from 'src/lib/ui';
import { cn } from 'src/lib/utils';
import { useStore } from 'src/store';
import type { ScreenshotCapture, StylePreset } from 'src/types';
import { ScreenshotStylePanel } from './_components/ScreenshotStylePanel';

type Props = {
  capture: ScreenshotCapture;
  onClose: () => void;
};

type Drag =
  | { mode: 'draw'; tool: DragShapeType; start: Point; current: Point }
  | { mode: 'move'; id: string; start: Point; current: Point };

const TOOLS: { id: AnnotationTool; hotkey: string }[] = [
  { id: 'select', hotkey: 'v' },
  { id: 'arrow', hotkey: 'a' },
  { id: 'box', hotkey: 'r' },
  { id: 'highlight', hotkey: 'h' },
  { id: 'blur', hotkey: 'b' },
  { id: 'text', hotkey: 't' },
  { id: 'step', hotkey: 'n' },
];

const TOOL_ICONS: Record<AnnotationTool, typeof IconPointer> = {
  select: IconPointer,
  arrow: IconArrowUpRight,
  box: IconSquare,
  highlight: IconHighlighter,
  blur: IconBlur,
  text: IconText,
  step: IconHash,
};

const TOOL_LABEL_KEYS = {
  select: 'toolSelect',
  arrow: 'toolArrow',
  box: 'toolBox',
  highlight: 'toolHighlight',
  blur: 'toolBlur',
  text: 'toolText',
  step: 'toolStep',
} as const;

const STAGE_PADDING = 48;
const HIT_TOLERANCE_CSS_PX = 6;

const newId = () => crypto.randomUUID();

const initialStyle = (capture: ScreenshotCapture): ScreenshotStyle => {
  const { recordingResult, frame } = useStore.getState();
  return {
    // A preview frame already carries the project's frame; don't wrap it twice.
    frameEnabled: capture.kind !== 'frame',
    aspectRatioId: 'original',
    background: { ...(recordingResult ? frame.background : DEFAULT_BACKGROUND) },
  };
};

export const ScreenshotEditor = ({ capture, onClose }: Props) => {
  const { t } = useTranslation('screenshot');
  const { t: tCommon } = useTranslation('common');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [style, setStyle] = useState<ScreenshotStyle>(() => initialStyle(capture));
  const [presets, setPresets] = useState<StylePreset[]>([]);
  const [annotations, dispatch] = useReducer(
    annotationsReducer,
    undefined,
    createInitialAnnotationsState,
  );
  const [tool, setTool] = useState<AnnotationTool>('arrow');
  const [color, setColor] = useState<string>(ANNOTATION_COLORS[0]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [textEdit, setTextEdit] = useState<TextEdit | null>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [wallpapersReady, setWallpapersReady] = useState(0);
  const [busy, setBusy] = useState(false);

  const shapeStyle = useMemo(
    () => ({ color, scale: getAnnotationScale(capture.width, capture.height) }),
    [capture.height, capture.width, color],
  );
  const geometry = useMemo(
    () => getScreenshotGeometry(capture.width, capture.height, style),
    [capture.height, capture.width, style],
  );
  const display = getContainRect(
    Math.max(stageSize.width - STAGE_PADDING, 0),
    Math.max(stageSize.height - STAGE_PADDING, 0),
    geometry.canvasWidth,
    geometry.canvasHeight,
  );
  // CSS pixels per canvas pixel.
  const displayScale = display.width / geometry.canvasWidth;

  useEffect(() => {
    const img = new Image();
    img.onload = () => setImage(img);
    img.src = capture.dataUrl;
    return () => {
      img.onload = null;
    };
  }, [capture.dataUrl]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([preloadWallpapersAsync(), preloadCustomWallpaperAsync()]).then(() => {
      if (!cancelled) {
        setWallpapersReady((n) => n + 1);
      }
    });
    void window.screenforge
      .getPresets()
      .then((list) => {
        if (!cancelled) {
          setPresets(list);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    const measure = () => {
      const rect = stage.getBoundingClientRect();
      setStageSize({ width: rect.width, height: rect.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  // Shapes as they should look right now: a shape being moved is shown at its
  // new spot, a shape being drawn is appended, a text box being edited is hidden
  // (the textarea stands in for it).
  const visibleShapes = useMemo(() => {
    let shapes: AnnotationShape[] = annotations.shapes;
    if (drag?.mode === 'move') {
      const dx = drag.current.x - drag.start.x;
      const dy = drag.current.y - drag.start.y;
      shapes = shapes.map((s) => (s.id === drag.id ? translateShape(s, dx, dy) : s));
    }
    if (drag?.mode === 'draw') {
      const draft = createShapeFromDrag(drag.tool, drag.start, drag.current, 'draft', shapeStyle);
      if (draft) {
        shapes = [...shapes, draft];
      }
    }
    if (textEdit?.editingId) {
      shapes = shapes.filter((s) => s.id !== textEdit.editingId);
    }
    return shapes;
  }, [annotations.shapes, drag, shapeStyle, textEdit]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !image) {
      return;
    }
    renderScreenshot(ctx, {
      image,
      imageWidth: capture.width,
      imageHeight: capture.height,
      style,
      geometry,
      shapes: visibleShapes,
      selectedId,
    });
  }, [
    capture.height,
    capture.width,
    geometry,
    image,
    selectedId,
    style,
    visibleShapes,
    wallpapersReady,
  ]);

  const toImagePoint = (e: { clientX: number; clientY: number }): Point | null => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return null;
    }
    const canvasPoint = clientToCanvasPoint(
      e.clientX,
      e.clientY,
      canvas.getBoundingClientRect(),
      geometry.canvasWidth,
      geometry.canvasHeight,
    );
    return imagePointFromCanvas(canvasPoint, geometry);
  };

  const hitTolerance = HIT_TOLERANCE_CSS_PX / Math.max(displayScale * geometry.scale, 0.0001);

  // The pointer-down that ends a text box also blurs the textarea; remember the
  // last edit handled so the same box is never committed twice.
  const handledTextEditRef = useRef<TextEdit | null>(null);

  const cancelTextEdit = (edit: TextEdit) => {
    handledTextEditRef.current = edit;
    setTextEdit(null);
  };

  const commitTextEdit = useCallback(
    (edit: TextEdit | null) => {
      if (!edit || handledTextEditRef.current === edit) {
        return;
      }
      handledTextEditRef.current = edit;
      setTextEdit(null);
      const action = resolveTextEdit(annotations.shapes, edit, newId(), shapeStyle);
      if (action) {
        dispatch(action);
      }
    },
    [annotations.shapes, shapeStyle],
  );

  const handlePointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) {
      return;
    }
    if (textEdit) {
      commitTextEdit(textEdit);
      return;
    }
    const point = toImagePoint(e);
    if (!point) {
      return;
    }
    e.currentTarget.setPointerCapture?.(e.pointerId);

    switch (tool) {
      case 'select': {
        const id = findShapeAt(annotations.shapes, point, hitTolerance);
        setSelectedId(id);
        if (id) {
          setDrag({ mode: 'move', id, start: point, current: point });
        }
        break;
      }
      case 'step':
        dispatch({ type: 'add', shape: createStepShape(point, newId(), shapeStyle) });
        setSelectedId(null);
        break;
      case 'text':
        // Without this the browser's mousedown that follows moves focus off the
        // new (auto-focused) text box, which then commits empty and vanishes.
        e.preventDefault();
        setSelectedId(null);
        setTextEdit({ point, value: '', editingId: null });
        break;
      default:
        setSelectedId(null);
        setDrag({ mode: 'draw', tool, start: point, current: point });
    }
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drag) {
      return;
    }
    const point = toImagePoint(e);
    if (point) {
      setDrag({ ...drag, current: point });
    }
  };

  const handlePointerUp = () => {
    if (!drag) {
      return;
    }
    if (drag.mode === 'draw') {
      const shape = createShapeFromDrag(drag.tool, drag.start, drag.current, newId(), shapeStyle);
      if (shape) {
        dispatch({ type: 'add', shape });
      }
    } else {
      const dx = drag.current.x - drag.start.x;
      const dy = drag.current.y - drag.start.y;
      const shape = annotations.shapes.find((s) => s.id === drag.id);
      if (shape && (dx !== 0 || dy !== 0)) {
        dispatch({ type: 'update', shape: translateShape(shape, dx, dy) });
      }
    }
    setDrag(null);
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const point = toImagePoint(e);
    if (!point) {
      return;
    }
    const id = findShapeAt(annotations.shapes, point, hitTolerance);
    const shape = annotations.shapes.find((s) => s.id === id);
    if (shape?.type === 'text') {
      setSelectedId(null);
      setTextEdit({ point: { x: shape.x, y: shape.y }, value: shape.text, editingId: shape.id });
    }
  };

  const handleColor = (next: string) => {
    setColor(next);
    const selected = annotations.shapes.find((s) => s.id === selectedId);
    if (selected && selected.type !== 'blur' && selected.color !== next) {
      dispatch({ type: 'update', shape: { ...selected, color: next } });
    }
  };

  const deleteSelected = () => {
    if (selectedId) {
      dispatch({ type: 'remove', id: selectedId });
      setSelectedId(null);
    }
  };

  const renderToDataUrl = async (): Promise<string | null> => {
    if (!image) {
      return null;
    }
    // Fold an open text box into the export without waiting for a re-render.
    const pending = textEdit
      ? resolveTextEdit(annotations.shapes, textEdit, newId(), shapeStyle)
      : null;
    const shapes = pending ? annotationsReducer(annotations, pending).shapes : annotations.shapes;
    if (style.frameEnabled && style.background.type === 'wallpaper') {
      await Promise.all([preloadWallpapersAsync(), preloadCustomWallpaperAsync()]);
    }
    const canvas = document.createElement('canvas');
    canvas.width = geometry.canvasWidth;
    canvas.height = geometry.canvasHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return null;
    }
    renderScreenshot(ctx, {
      image,
      imageWidth: capture.width,
      imageHeight: capture.height,
      style,
      geometry,
      shapes,
    });
    return canvas.toDataURL('image/png');
  };

  const exportProps = () => ({
    kind: capture.kind,
    framed: style.frameEnabled,
    annotations: annotations.shapes.length,
  });

  const handleCopy = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await renderToDataUrl();
      if (!dataUrl) {
        throw new Error('Nothing to render');
      }
      await window.screenforge.copyScreenshotToClipboard(dataUrl);
      trackEvent('screenshot_copied', exportProps());
      toast.success(t('copied'));
    } catch {
      toast.error(t('copyFailed'));
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await renderToDataUrl();
      if (!dataUrl) {
        throw new Error('Nothing to render');
      }
      const filePath = await window.screenforge.saveScreenshot(dataUrl);
      trackEvent('screenshot_saved', exportProps());
      toast.success(t('saved'), {
        action: {
          label: tCommon('showInFinder'),
          onClick: () => void window.screenforge.revealExportInFolder(filePath),
        },
      });
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const notTyping = !textEdit;
  useHotkeys('delete, backspace', deleteSelected, {
    enabled: notTyping && !!selectedId,
    preventDefault: true,
  });
  useHotkeys('mod+z', () => dispatch({ type: 'undo' }), {
    enabled: notTyping,
    preventDefault: true,
  });
  useHotkeys('mod+shift+z, ctrl+y', () => dispatch({ type: 'redo' }), {
    enabled: notTyping,
    preventDefault: true,
  });
  useHotkeys('mod+c', () => void handleCopy(), { enabled: notTyping, preventDefault: true });
  useHotkeys('mod+s', () => void handleSave(), { enabled: notTyping, preventDefault: true });
  useHotkeys('escape', () => setSelectedId(null), { enabled: notTyping });
  useHotkeys(
    TOOLS.map((item) => item.hotkey).join(', '),
    (_event, handler) => {
      const match = TOOLS.find((item) => handler.keys?.includes(item.hotkey));
      if (match) {
        setTool(match.id);
      }
    },
    { enabled: notTyping },
  );

  const textOverlay = (() => {
    if (!textEdit) {
      return null;
    }
    const editing = annotations.shapes.find((s) => s.id === textEdit.editingId);
    const fontSize =
      editing?.type === 'text' ? editing.fontSize : getDefaultFontSize(shapeStyle.scale);
    const at = canvasPointFromImage(textEdit.point, geometry);
    return {
      left: at.x * displayScale,
      top: at.y * displayScale,
      fontSize: Math.max(10, fontSize * geometry.scale * displayScale),
      color: editing?.color ?? color,
    };
  })();

  const cursor =
    tool === 'select'
      ? drag?.mode === 'move'
        ? 'grabbing'
        : 'default'
      : tool === 'text'
        ? 'text'
        : 'crosshair';

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-sf-bg font-sans text-sf-primary">
      <header className="flex flex-none items-center gap-3 border-b border-sf-border px-3 py-2">
        <Button variant="ghost" size="icon-sm" aria-label={t('close')} onClick={onClose}>
          <IconX size={16} />
        </Button>
        <span className="text-md font-medium">{t('title')}</span>
        <span className="text-xs tabular-nums text-sf-muted">
          {capture.width}&thinsp;×&thinsp;{capture.height}
        </span>

        <div className="mx-auto flex items-center gap-3">
          <div className="flex items-center gap-0.5 rounded-lg border border-sf-border bg-sf-panel p-0.5">
            {TOOLS.map(({ id, hotkey }) => {
              const Icon = TOOL_ICONS[id];
              const label = t(TOOL_LABEL_KEYS[id]);
              return (
                <Tooltip key={id}>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={label}
                      aria-pressed={tool === id}
                      active={tool === id}
                      onClick={() => setTool(id)}
                    >
                      <Icon size={16} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {label} <span className="ml-1 uppercase text-sf-muted">{hotkey}</span>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>

          <div className="flex items-center gap-1" role="radiogroup" aria-label={t('color')}>
            {ANNOTATION_COLORS.map((swatch) => (
              <button
                key={swatch}
                type="button"
                role="radio"
                aria-checked={color === swatch}
                aria-label={swatch}
                onClick={() => handleColor(swatch)}
                className={cn(
                  'size-5 cursor-pointer rounded-full border border-white/20 transition-transform active:scale-90',
                  color === swatch && 'ring-2 ring-sf-border-lt ring-offset-2 ring-offset-sf-bg',
                )}
                style={{ background: swatch }}
              />
            ))}
          </div>

          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('undo')}
              disabled={annotations.past.length === 0}
              onClick={() => dispatch({ type: 'undo' })}
            >
              <IconArrowBackUp size={16} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('redo')}
              disabled={annotations.future.length === 0}
              onClick={() => dispatch({ type: 'redo' })}
            >
              <IconArrowForwardUp size={16} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('deleteShape')}
              disabled={!selectedId}
              onClick={deleteSelected}
            >
              <IconTrash size={16} />
            </Button>
          </div>
        </div>

        <Button variant="secondary" size="sm" disabled={!image || busy} onClick={handleCopy}>
          <IconCopy size={14} />
          {t('copy')}
        </Button>
        <Button size="sm" disabled={!image || busy} onClick={handleSave}>
          <IconDownload size={14} />
          {t('save')}
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <div
          ref={stageRef}
          className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden"
        >
          <div className="relative" style={{ width: display.width, height: display.height }}>
            <canvas
              ref={canvasRef}
              width={geometry.canvasWidth}
              height={geometry.canvasHeight}
              className="block h-full w-full touch-none select-none"
              style={{ cursor }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={() => setDrag(null)}
              onDoubleClick={handleDoubleClick}
            />
            {textEdit && textOverlay && (
              <textarea
                autoFocus
                rows={Math.max(1, textEdit.value.split('\n').length)}
                value={textEdit.value}
                placeholder={t('textPlaceholder')}
                onChange={(e) => setTextEdit({ ...textEdit, value: e.target.value })}
                onBlur={() => commitTextEdit(textEdit)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    commitTextEdit(textEdit);
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    cancelTextEdit(textEdit);
                  }
                }}
                className="absolute min-w-[12ch] resize-none overflow-hidden whitespace-pre border border-dashed border-white/70 bg-black/30 p-0 font-semibold leading-[1.25] outline-none placeholder:text-white/50"
                style={{
                  left: textOverlay.left,
                  top: textOverlay.top,
                  fontSize: textOverlay.fontSize,
                  color: textOverlay.color,
                  fieldSizing: 'content',
                }}
              />
            )}
          </div>
        </div>

        <aside className="w-72 flex-none overflow-y-auto border-l border-sf-border bg-sf-panel p-4">
          <div className="mb-4 text-sm font-medium tracking-[0.04em] text-sf-primary">
            {t('style')}
          </div>
          <ScreenshotStylePanel style={style} presets={presets} onChange={setStyle} />
        </aside>
      </div>
    </div>
  );
};
