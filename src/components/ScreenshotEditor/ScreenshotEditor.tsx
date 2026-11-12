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
  type AnnotationsAction,
  type AnnotationsState,
  type AnnotationTool,
  type DragShapeType,
  type Point,
  type TextEdit,
} from 'src/lib/screenshot/annotations';
import {
  FLAT_STUDIO,
  canvasPointFromImage,
  clientToCanvasPoint,
  getPreviewRect,
  getScreenshotGeometry,
  imagePointFromCanvas,
  renderScreenshot,
  type ScreenshotStyle,
} from 'src/lib/screenshot/compose';
import {
  StudioRenderer,
  clampOffset,
  defaultLightHandle,
  depthAfterWheel,
  getStudioLook,
  getStudioOutputSize,
  imageStats,
  type StudioPoint,
} from 'src/lib/screenshot/studio';
import { canvasToPng } from 'src/lib/screenshot/png';
import type { WindowBarPage } from 'src/lib/window-bar';
import {
  WINDOW_BAR_PLACEHOLDER_TEXT,
  pageTitleFromWindowTitle,
} from 'src/lib/recording/captureSource';
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
import { Button, PreviewCardProvider, Tooltip, TooltipContent, TooltipTrigger } from 'src/lib/ui';
import { cn } from 'src/lib/utils';
import { useStore } from 'src/store';
import type { ScreenshotCapture, StylePreset } from 'src/types';
import { ScreenshotStylePanel } from './_components/ScreenshotStylePanel';
import { TopBarButton, TopBarGroup } from './_components/TopBarButtons';

type Props = {
  capture: ScreenshotCapture;
  onClose: () => void;
};

type Drag =
  | { mode: 'draw'; tool: DragShapeType; start: Point; current: Point }
  | { mode: 'move'; id: string; start: Point; current: Point }
  /** Studio: moving the screenshot around the output (client pixels). */
  | { mode: 'pan'; start: Point; current: Point; origin: StudioPoint }
  /** Studio: moving the light handle (fractions of the output). */
  | { mode: 'light'; start: StudioPoint; current: StudioPoint };

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
/** The studio preview never renders above 2x; past that the GPU cost outgrows what the eye sees. */
const STUDIO_MAX_DPR = 2;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Mean brightness of a screenshot, from a small downscaled copy. */
const measureLuminance = (image: HTMLImageElement): number => {
  try {
    const canvas = Object.assign(document.createElement('canvas'), { width: 96, height: 60 });
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return 0.5;
    }
    ctx.drawImage(image, 0, 0, 96, 60);
    return imageStats(ctx.getImageData(0, 0, 96, 60).data).lum;
  } catch {
    return 0.5;
  }
};

const newId = () => crypto.randomUUID();

/** Shapes and style share one undo history, so Cmd+Z undoes whatever was done last. */
const editorReducer = (
  state: AnnotationsState<ScreenshotStyle>,
  action: AnnotationsAction<ScreenshotStyle>,
) => annotationsReducer(state, action);

const initialStyle = (capture: ScreenshotCapture): ScreenshotStyle => {
  const { recordingResult, frame } = useStore.getState();
  return {
    // A preview frame already carries the project's frame; don't wrap it twice.
    frameEnabled: capture.kind !== 'frame',
    aspectRatioId: 'original',
    background: { ...(recordingResult ? frame.background : DEFAULT_BACKGROUND) },
    // The project's window bar to start with; a preview frame already has it
    // drawn in, so it starts without one (any capture can still pick a bar).
    ...(recordingResult &&
      frame.windowBar &&
      capture.kind !== 'frame' && { windowBar: { ...frame.windowBar } }),
  };
};

/** The page a capture shows, for its window bar: the window's title at the moment of capture. */
const capturePage = (capture: ScreenshotCapture): WindowBarPage | null =>
  capture.windowTitle
    ? { title: pageTitleFromWindowTitle(capture.windowTitle, capture.appName) }
    : null;

export const ScreenshotEditor = ({ capture, onClose }: Props) => {
  const { t } = useTranslation('screenshot');
  const { t: tCommon } = useTranslation('common');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [presets, setPresets] = useState<StylePreset[]>([]);
  const [annotations, dispatch] = useReducer(editorReducer, capture, (initial) =>
    createInitialAnnotationsState(initialStyle(initial)),
  );
  const { style } = annotations;
  const setStyle = (next: ScreenshotStyle, group?: string) =>
    dispatch({ type: 'setStyle', style: next, group });
  const [tool, setTool] = useState<AnnotationTool>('arrow');
  const [color, setColor] = useState<string>(ANNOTATION_COLORS[0]);
  const [rawSelectedId, setSelectedId] = useState<string | null>(null);
  // An undo can take the selected shape away; treat it as deselected then.
  const selectedId = annotations.shapes.some((s) => s.id === rawSelectedId) ? rawSelectedId : null;
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [textEdit, setTextEdit] = useState<TextEdit | null>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [wallpapersReady, setWallpapersReady] = useState(0);
  const [busy, setBusy] = useState(false);
  const [studioFailed, setStudioFailed] = useState(false);
  const [studioReady, setStudioReady] = useState(0);
  const [offScreen, setOffScreen] = useState(false);
  const studioCanvasRef = useRef<HTMLCanvasElement>(null);
  const studioRef = useRef<StudioRenderer | null>(null);
  // The screenshot with its annotations, flat: the studio's screen texture.
  const flatCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const studio = style.studio ?? FLAT_STUDIO;
  const look = getStudioLook(studio.lookId);
  const studioOn = !!look && !studioFailed;
  // Without a working studio, the panel always sees (and edits) the flat frame, whatever an
  // undo or redo brings back.
  const panelStyle = useMemo(
    () => (studioFailed ? { ...style, studio: FLAT_STUDIO } : style),
    [style, studioFailed],
  );

  const shapeStyle = useMemo(
    () => ({ color, scale: getAnnotationScale(capture.width, capture.height) }),
    [capture.height, capture.width, color],
  );
  const geometry = useMemo(
    () =>
      getScreenshotGeometry(capture.width, capture.height, style, undefined, {
        scaleFactor: capture.scaleFactor ?? 1,
      }),
    [capture, style],
  );
  // The studio's screen: the screenshot at full size, no frame. Independent of the style, so
  // moving the screenshot or picking a look never repaints it.
  const flatStyle = useMemo<ScreenshotStyle>(
    () => ({ frameEnabled: false, aspectRatioId: 'original', background: DEFAULT_BACKGROUND }),
    [],
  );
  const flatGeometry = useMemo(
    () => getScreenshotGeometry(capture.width, capture.height, flatStyle),
    [capture.height, capture.width, flatStyle],
  );
  const studioSize = useMemo(
    () => getStudioOutputSize(capture.width, capture.height, style),
    [capture.height, capture.width, style],
  );
  // The flat frame is never shown larger than one canvas pixel per device pixel (a small
  // capture stretched to fill the stage looks blurry); the studio renders at the stage's size.
  const display = studioOn
    ? getContainRect(
        Math.max(stageSize.width - STAGE_PADDING, 0),
        Math.max(stageSize.height - STAGE_PADDING, 0),
        studioSize.width,
        studioSize.height,
      )
    : getPreviewRect(
        Math.max(stageSize.width - STAGE_PADDING, 0),
        Math.max(stageSize.height - STAGE_PADDING, 0),
        geometry.canvasWidth,
        geometry.canvasHeight,
        window.devicePixelRatio,
      );
  // CSS pixels per canvas pixel.
  const displayScale = display.width / geometry.canvasWidth;
  const imageLum = useMemo(
    () => (studioOn && image ? measureLuminance(image) : 0.5),
    [image, studioOn],
  );

  useEffect(() => {
    const img = new Image();
    img.onload = () => setImage(img);
    img.src = capture.imageUrl;
    return () => {
      img.onload = null;
    };
  }, [capture.imageUrl]);

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
  // Only shape drags change the shapes; moving the screenshot or the light must not
  // repaint (and re-upload) the whole screenshot.
  const shapeDrag = drag?.mode === 'move' || drag?.mode === 'draw' ? drag : null;
  const visibleShapes = useMemo(() => {
    let shapes: AnnotationShape[] = annotations.shapes;
    if (shapeDrag?.mode === 'move') {
      const dx = shapeDrag.current.x - shapeDrag.start.x;
      const dy = shapeDrag.current.y - shapeDrag.start.y;
      shapes = shapes.map((s) => (s.id === shapeDrag.id ? translateShape(s, dx, dy) : s));
    }
    if (shapeDrag?.mode === 'draw') {
      const draft = createShapeFromDrag(
        shapeDrag.tool,
        shapeDrag.start,
        shapeDrag.current,
        'draft',
        shapeStyle,
      );
      if (draft) {
        shapes = [...shapes, draft];
      }
    }
    if (textEdit?.editingId) {
      shapes = shapes.filter((s) => s.id !== textEdit.editingId);
    }
    return shapes;
  }, [annotations.shapes, shapeDrag, shapeStyle, textEdit]);

  /** Paint the screenshot and its annotations, flat, and hand them to the studio as its screen. */
  const paintStudioScreen = useCallback(
    (shapes: readonly AnnotationShape[], selected: string | null) => {
      const renderer = studioRef.current;
      if (!renderer || !image) {
        return;
      }
      const canvas = flatCanvasRef.current ?? document.createElement('canvas');
      flatCanvasRef.current = canvas;
      if (
        canvas.width !== flatGeometry.canvasWidth ||
        canvas.height !== flatGeometry.canvasHeight
      ) {
        canvas.width = flatGeometry.canvasWidth;
        canvas.height = flatGeometry.canvasHeight;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return;
      }
      renderScreenshot(ctx, {
        image,
        imageWidth: capture.width,
        imageHeight: capture.height,
        style: flatStyle,
        geometry: flatGeometry,
        shapes,
        selectedId: selected,
      });
      renderer.setScreen(canvas, canvas.width, canvas.height, imageLum);
    },
    [capture.height, capture.width, flatGeometry, flatStyle, image, imageLum],
  );

  // One renderer per studio session: created when a look is turned on, freed when it is turned off.
  useEffect(() => {
    if (!studioOn) {
      return;
    }
    const canvas = studioCanvasRef.current;
    const settings = getStudioLook(studio.lookId)?.settings;
    if (!canvas || !settings) {
      return;
    }
    let renderer: StudioRenderer;
    try {
      renderer = new StudioRenderer(canvas, settings);
    } catch {
      // The editor falls back to the flat frame; the panel is shown that (see panelStyle), so
      // nothing goes into the undo history that Undo could bring back.
      setStudioFailed(true);
      toast.error(t('studioUnavailable'));
      return;
    }
    studioRef.current = renderer;
    renderer.start();
    setStudioReady((n) => n + 1);
    return () => {
      studioRef.current = null;
      appliedLookRef.current = null;
      renderer.dispose();
    };
    // Only on/off recreates the renderer; look changes are applied below, animated.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioOn]);

  const appliedLookRef = useRef<string | null>(null);
  useEffect(() => {
    const renderer = studioRef.current;
    if (!renderer || !look) {
      return;
    }
    if (appliedLookRef.current !== null && appliedLookRef.current !== look.id) {
      renderer.setSettings(look.settings, true);
    }
    appliedLookRef.current = look.id;
  }, [look, studioReady]);

  useEffect(() => {
    studioRef.current?.resize(
      display.width,
      display.height,
      Math.min(window.devicePixelRatio || 1, STUDIO_MAX_DPR),
    );
  }, [display.width, display.height, studioReady]);

  const studioPose = useMemo(() => {
    if (drag?.mode === 'pan' && display.width > 0 && display.height > 0) {
      return {
        offset: {
          ...clampOffset({
            x: drag.origin.x + (drag.current.x - drag.start.x) / display.width,
            y: drag.origin.y + (drag.current.y - drag.start.y) / display.height,
          }),
        },
        depth: studio.depth,
        light: studio.light,
      };
    }
    if (drag?.mode === 'light') {
      return { offset: studio.offset, depth: studio.depth, light: drag.current };
    }
    return { offset: studio.offset, depth: studio.depth, light: studio.light };
  }, [display.height, display.width, drag, studio.depth, studio.light, studio.offset]);

  useEffect(() => {
    const renderer = studioRef.current;
    if (!renderer) {
      return;
    }
    renderer.setOffset(studioPose.offset, studioPose.depth);
    renderer.setLightHandle(studioPose.light);
  }, [studioPose, studioReady]);

  // Scroll (or pinch) over the studio: bring the screenshot closer or push it back. One gesture
  // is one undo step; the depth is tracked here between renders so fast wheels lose nothing.
  const wheelGesture = useRef<{ group: string; at: number; depth: number } | null>(null);
  const handleWheel = useRef<(e: WheelEvent) => void>(() => undefined);
  useLayoutEffect(() => {
    handleWheel.current = (e: WheelEvent) => {
      const renderer = studioRef.current;
      if (!renderer || drag) {
        return;
      }
      e.preventDefault();
      const now = performance.now();
      const gesture =
        wheelGesture.current && now - wheelGesture.current.at < 400
          ? wheelGesture.current
          : { group: `studio-depth-${now}`, at: now, depth: studio.depth };
      // Line-based wheels (deltaMode 1) report notches, not pixels.
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : 1);
      const depth = Math.min(depthAfterWheel(gesture.depth, delta), renderer.maxDepth());
      wheelGesture.current = { ...gesture, at: now, depth };
      if (depth !== studio.depth) {
        setStyle({ ...style, studio: { ...studio, depth } }, gesture.group);
      }
    };
  });
  useEffect(() => {
    const canvas = studioCanvasRef.current;
    if (!studioOn || !canvas) {
      return;
    }
    // Not React's onWheel: that listener is passive and can't stop the page from zooming.
    const onWheel = (e: WheelEvent) => handleWheel.current(e);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [studioOn, studioReady]);

  const lightHandle = studioPose.light ?? (look ? defaultLightHandle(look.settings.envRot) : null);

  // At most one repaint per frame, however fast pointer events arrive while drawing.
  useEffect(() => {
    if (!studioOn) {
      return;
    }
    const frame = requestAnimationFrame(() => paintStudioScreen(visibleShapes, selectedId));
    return () => cancelAnimationFrame(frame);
  }, [paintStudioScreen, selectedId, studioOn, studioReady, visibleShapes]);

  useEffect(() => {
    if (studioOn) {
      return;
    }
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
      windowBarPage: capturePage(capture),
    });
  }, [capture, geometry, image, selectedId, studioOn, style, visibleShapes, wallpapersReady]);

  const toImagePoint = (e: { clientX: number; clientY: number }): Point | null => {
    if (studioOn) {
      const renderer = studioRef.current;
      const rect = studioCanvasRef.current?.getBoundingClientRect();
      if (!renderer || !rect || rect.width === 0 || rect.height === 0) {
        return null;
      }
      // The studio's screen is the flat canvas, which is capped in size: back to capture pixels.
      const hit = renderer.pickImagePoint(
        (e.clientX - rect.left) / rect.width,
        (e.clientY - rect.top) / rect.height,
      );
      return hit ? { x: hit.x / flatGeometry.scale, y: hit.y / flatGeometry.scale } : null;
    }
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

  // In the studio the screen is foreshortened; this rough scale is close enough for picking.
  const pickScale = studioOn
    ? (display.width * 0.6) / Math.max(capture.width, 1)
    : displayScale * geometry.scale;
  const hitTolerance = HIT_TOLERANCE_CSS_PX / Math.max(pickScale, 0.0001);

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

  const startPan = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setSelectedId(null);
    const at = { x: e.clientX, y: e.clientY };
    setDrag({ mode: 'pan', start: at, current: at, origin: studio.offset });
  };

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
      // Studio: off the screenshot, a drag moves it.
      if (studioOn) {
        startPan(e);
      }
      return;
    }
    e.currentTarget.setPointerCapture?.(e.pointerId);

    // Whatever the tool, pressing anywhere on an existing annotation (its fill
    // too, not just its edge) picks it up to move.
    const grabbed = findShapeAt(annotations.shapes, point, hitTolerance);
    if (grabbed) {
      // Keeps the Text tool's mousedown from stealing focus (see below).
      e.preventDefault();
      setSelectedId(grabbed);
      setDrag({ mode: 'move', id: grabbed, start: point, current: point });
      return;
    }

    switch (tool) {
      case 'select':
        // Studio: with Select, dragging the screenshot itself moves it too.
        if (studioOn) {
          startPan(e);
        } else {
          setSelectedId(null);
        }
        break;
      case 'step': {
        const shape = createStepShape(point, newId(), shapeStyle);
        dispatch({ type: 'add', shape });
        setSelectedId(shape.id);
        break;
      }
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
    if (drag?.mode === 'pan') {
      setDrag({ ...drag, current: { x: e.clientX, y: e.clientY } });
      return;
    }
    const point = toImagePoint(e);
    if (studioOn && !drag && (point === null) !== offScreen) {
      setOffScreen(point === null);
    }
    if (!point) {
      return;
    }
    if (drag?.mode === 'draw' || drag?.mode === 'move') {
      setDrag({ ...drag, current: point });
      return;
    }
    const hovered = textEdit ? null : findShapeAt(annotations.shapes, point, hitTolerance);
    if (hovered !== hoveredId) {
      setHoveredId(hovered);
    }
  };

  const commitStudio = (patch: Partial<typeof studio>) =>
    setStyle({ ...style, studio: { ...studio, ...patch } });

  const handlePointerUp = () => {
    if (!drag) {
      return;
    }
    if (drag.mode === 'pan') {
      if (drag.current.x !== drag.start.x || drag.current.y !== drag.start.y) {
        commitStudio({ offset: studioPose.offset });
      }
    } else if (drag.mode === 'light') {
      // A plain click on the handle keeps the look's own light (and adds no undo step).
      if (drag.current.x !== drag.start.x || drag.current.y !== drag.start.y) {
        commitStudio({ light: drag.current });
      }
    } else if (drag.mode === 'draw') {
      const shape = createShapeFromDrag(drag.tool, drag.start, drag.current, newId(), shapeStyle);
      if (shape) {
        dispatch({ type: 'add', shape });
        // Selected straight away, so a colour pick or Delete applies to it.
        setSelectedId(shape.id);
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

  const renderToPng = async (): Promise<Uint8Array | null> => {
    if (!image) {
      return null;
    }
    // Fold an open text box into the export without waiting for a re-render.
    const pending = textEdit
      ? resolveTextEdit(annotations.shapes, textEdit, newId(), shapeStyle)
      : null;
    const shapes = pending ? annotationsReducer(annotations, pending).shapes : annotations.shapes;
    const renderer = studioRef.current;
    if (studioOn && renderer) {
      // Layer every sharp frame at full size, then put the live view (with its selection) back.
      paintStudioScreen(shapes, null);
      const still = renderer.renderStill(studioSize.width, studioSize.height);
      paintStudioScreen(visibleShapes, selectedId);
      return canvasToPng(still);
    }
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
      windowBarPage: capturePage(capture),
    });
    return canvasToPng(canvas);
  };

  const exportProps = () => ({
    kind: capture.kind,
    framed: style.frameEnabled,
    look: studioOn ? studio.lookId : null,
    annotations: annotations.shapes.length,
  });

  // Mid-gesture, the preview shows a shape the annotations don't hold yet:
  // exporting then could leave out a blur the user can already see.
  const canExport = !!image && !busy && !drag;

  const handleCopy = async () => {
    if (!canExport) {
      return;
    }
    setBusy(true);
    try {
      const png = await renderToPng();
      if (!png) {
        throw new Error('Nothing to render');
      }
      await window.screenforge.copyScreenshotToClipboard(png);
      trackEvent('screenshot_copied', exportProps());
      toast.success(t('copied'));
    } catch {
      toast.error(t('copyFailed'));
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    if (!canExport) {
      return;
    }
    setBusy(true);
    try {
      const png = await renderToPng();
      if (!png) {
        throw new Error('Nothing to render');
      }
      const filePath = await window.screenforge.saveScreenshot(png);
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
    if (studioOn) {
      const renderer = studioRef.current;
      // Capture pixels → the flat canvas the studio shows.
      const k = flatGeometry.scale;
      const at = renderer?.projectImagePoint(textEdit.point.x * k, textEdit.point.y * k);
      const next = renderer?.projectImagePoint((textEdit.point.x + 100) * k, textEdit.point.y * k);
      if (!at || !next) {
        return null;
      }
      const scale =
        Math.hypot((next.x - at.x) * display.width, (next.y - at.y) * display.height) / 100;
      return {
        left: at.x * display.width,
        top: at.y * display.height,
        fontSize: Math.max(10, fontSize * scale),
        color: editing?.color ?? color,
      };
    }
    const at = canvasPointFromImage(textEdit.point, geometry);
    return {
      left: at.x * displayScale,
      top: at.y * displayScale,
      fontSize: Math.max(10, fontSize * geometry.scale * displayScale),
      color: editing?.color ?? color,
    };
  })();

  const cursor =
    drag?.mode === 'move' || drag?.mode === 'pan'
      ? 'grabbing'
      : hoveredId
        ? 'move'
        : studioOn && (offScreen || tool === 'select')
          ? 'grab'
          : tool === 'select'
            ? 'default'
            : tool === 'text'
              ? 'text'
              : 'crosshair';

  const canvasHandlers = {
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: () => setDrag(null),
    onPointerLeave: () => setHoveredId(null),
    onDoubleClick: handleDoubleClick,
  };

  const lightFromEvent = (e: { clientX: number; clientY: number }): StudioPoint | null => {
    const rect = studioCanvasRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) {
      return null;
    }
    return {
      x: clamp((e.clientX - rect.left) / rect.width, -0.2, 1.2),
      y: clamp((e.clientY - rect.top) / rect.height, 0, 0.6),
    };
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-sf-bg font-sans text-sf-primary">
      <header className="flex flex-none items-center gap-3 border-b border-sf-border px-3 py-2">
        <Button
          variant="ghost"
          size="icon"
          className="rounded-md"
          aria-label={t('close')}
          onClick={onClose}
        >
          <IconX size={20} />
        </Button>
        <span className="text-md font-medium">{t('title')}</span>
        <span className="text-xs tabular-nums text-sf-muted">
          {capture.width}&thinsp;×&thinsp;{capture.height}
        </span>

        <div className="mx-auto flex items-center gap-3">
          <TopBarGroup
            id="screenshot-tools"
            aria-label={t('tools')}
            className="flex items-center gap-0.5 rounded-lg border border-sf-border bg-sf-panel p-0.5"
          >
            {TOOLS.map(({ id, hotkey }) => {
              const Icon = TOOL_ICONS[id];
              const label = t(TOOL_LABEL_KEYS[id]);
              return (
                <Tooltip key={id}>
                  <TooltipTrigger asChild>
                    <TopBarButton
                      itemId={id}
                      selected={tool === id}
                      aria-label={label}
                      aria-pressed={tool === id}
                      onClick={() => setTool(id)}
                    >
                      <Icon size={20} />
                    </TopBarButton>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {label} <span className="ml-1 uppercase text-sf-muted">{hotkey}</span>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </TopBarGroup>

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

          <TopBarGroup
            id="screenshot-actions"
            aria-label={t('actions')}
            className="flex items-center gap-0.5"
          >
            <TopBarButton
              itemId="undo"
              aria-label={t('undo')}
              disabled={annotations.past.length === 0}
              onClick={() => dispatch({ type: 'undo' })}
            >
              <IconArrowBackUp size={20} />
            </TopBarButton>
            <TopBarButton
              itemId="redo"
              aria-label={t('redo')}
              disabled={annotations.future.length === 0}
              onClick={() => dispatch({ type: 'redo' })}
            >
              <IconArrowForwardUp size={20} />
            </TopBarButton>
            <TopBarButton
              itemId="delete"
              aria-label={t('deleteShape')}
              disabled={!selectedId}
              onClick={deleteSelected}
            >
              <IconTrash size={20} />
            </TopBarButton>
          </TopBarGroup>
        </div>

        <Button variant="secondary" size="sm" disabled={!canExport} onClick={handleCopy}>
          <IconCopy size={14} />
          {t('copy')}
        </Button>
        <Button size="sm" disabled={!canExport} onClick={handleSave}>
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
            {studioOn ? (
              // Keyed: a canvas that has held a 2D context can never take a WebGL one.
              <canvas
                key="studio"
                ref={studioCanvasRef}
                className="block h-full w-full touch-none select-none"
                style={{ cursor }}
                {...canvasHandlers}
              />
            ) : (
              <canvas
                key="flat"
                ref={canvasRef}
                width={geometry.canvasWidth}
                height={geometry.canvasHeight}
                className="block h-full w-full touch-none select-none"
                style={{ cursor }}
                {...canvasHandlers}
              />
            )}
            {studioOn && lightHandle && (
              <button
                type="button"
                aria-label={t('lightHandle')}
                title={t('lightHandle')}
                className="absolute size-3.5 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full border border-white/70 bg-white/25 opacity-60 shadow-[0_0_0_1px_rgba(0,0,0,0.25),0_0_10px_rgba(255,255,255,0.45)] transition-opacity hover:opacity-100 active:cursor-grabbing"
                style={{
                  left: clamp(lightHandle.x, 0, 1) * display.width,
                  top: clamp(lightHandle.y, 0, 1) * display.height,
                }}
                onPointerDown={(e) => {
                  if (e.button !== 0) {
                    return;
                  }
                  e.stopPropagation();
                  e.currentTarget.setPointerCapture?.(e.pointerId);
                  const at = lightFromEvent(e);
                  if (at) {
                    setDrag({ mode: 'light', start: at, current: at });
                  }
                }}
                onPointerMove={(e) => {
                  if (drag?.mode !== 'light') {
                    return;
                  }
                  const at = lightFromEvent(e);
                  if (at) {
                    setDrag({ ...drag, current: at });
                  }
                }}
                onPointerUp={handlePointerUp}
                onPointerCancel={() => setDrag(null)}
                onDoubleClick={() => {
                  if (studio.light !== null) {
                    commitStudio({ light: null });
                  }
                }}
              />
            )}
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

        <aside
          className="w-72 flex-none overflow-y-auto border-l border-sf-border bg-sf-panel p-4"
          // Hover cards (the window bar's styles) sit beside this panel.
          data-preview-boundary
        >
          <div className="mb-4 text-sm font-medium tracking-[0.04em] text-sf-primary">
            {t('style')}
          </div>
          {/* Hover a window bar style for a preview of it. */}
          <PreviewCardProvider>
            <ScreenshotStylePanel
              style={panelStyle}
              presets={presets}
              looksAvailable={!studioFailed}
              onChange={setStyle}
              windowBarText={capturePage(capture)?.title || WINDOW_BAR_PLACEHOLDER_TEXT}
              captureImage={capture.imageUrl}
              capturePage={capturePage(capture)}
            />
          </PreviewCardProvider>
        </aside>
      </div>
    </div>
  );
};
