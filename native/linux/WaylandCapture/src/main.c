/*
 * screenforge-wayland-capture: records a screen on a Wayland desktop, with the
 * pointer kept out of the picture and reported on its own.
 *
 * Wayland lets an app see the screen only through a screen-cast session from
 * xdg-desktop-portal, and lets no app read the pointer. This helper opens such
 * a session for one screen (the user picks it in the system dialog) with the
 * pointer sent as metadata: every PipeWire buffer carries the picture without
 * the pointer, plus the pointer's position. The app draws its own cursor from
 * those positions, so the recording shows it once.
 *
 * Events, one JSON object per line on stdout:
 *   {"type":"ready","screen":{"x":0,"y":0,"width":2560,"height":1440}}
 *   {"type":"video","width":2560,"height":1440,"format":"bgr0"}
 *   {"type":"move","x":812.5,"y":440}
 *   {"type":"recording"}
 *   {"type":"recorded","ok":true,"frames":1800,"late":0}
 *   {"type":"still","path":"/tmp/x.bgra","width":2560,"height":1440}
 *   {"type":"ended"}
 *   {"type":"error","code":"cancelled|unsupported|failed","message":"..."}
 * x/y and the screen are in the desktop's logical coordinates; "video" is the
 * picture's pixel size and FFmpeg pixel format.
 *
 * Commands, one per line on stdin, fields separated by tabs:
 *   record <fps> <ffmpeg> <arg>...   pipe raw frames into FFmpeg at <fps>
 *   pause | resume                   hold the recording (no frames meanwhile)
 *   stop                             finish the recording
 *   still <path>                     write the current picture as raw BGRA
 * It exits when stdin closes, on SIGTERM/SIGINT, or when the share ends; a
 * recording in progress is finished first.
 */

#define _GNU_SOURCE
#include <gio/gio.h>
#include <gio/gunixfdlist.h>
#include <pipewire/pipewire.h>
#include <spa/buffer/meta.h>
#include <spa/param/video/format-utils.h>
#include <spa/pod/builder.h>

#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <math.h>
#include <pthread.h>
#include <signal.h>
#include <spawn.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

extern char **environ;

#define PORTAL_BUS "org.freedesktop.portal.Desktop"
#define PORTAL_PATH "/org/freedesktop/portal/desktop"
#define SCREENCAST_IFACE "org.freedesktop.portal.ScreenCast"
#define REQUEST_IFACE "org.freedesktop.portal.Request"

#define SOURCE_TYPE_MONITOR 1u
#define CURSOR_MODE_METADATA 4u
#define MAX_FFMPEG_ARGS 128

#define CURSOR_META_SIZE(w, h) \
  (sizeof(struct spa_meta_cursor) + sizeof(struct spa_meta_bitmap) + (size_t)(w) * (h) * 4)

/* ── JSON output (only the PipeWire thread prints) ───────────────────────── */

static void print_json_string(const char *value) {
  putchar('"');
  for (const unsigned char *p = (const unsigned char *)(value ? value : ""); *p; p++) {
    switch (*p) {
      case '"': fputs("\\\"", stdout); break;
      case '\\': fputs("\\\\", stdout); break;
      case '\n': fputs("\\n", stdout); break;
      case '\r': fputs("\\r", stdout); break;
      case '\t': fputs("\\t", stdout); break;
      default:
        if (*p < 0x20) {
          printf("\\u%04x", *p);
        } else {
          putchar(*p);
        }
    }
  }
  putchar('"');
}

static void emit_error(const char *code, const char *message) {
  fputs("{\"type\":\"error\",\"code\":", stdout);
  print_json_string(code);
  fputs(",\"message\":", stdout);
  print_json_string(message);
  fputs("}\n", stdout);
  fflush(stdout);
}

static void emit_simple(const char *type) {
  printf("{\"type\":\"%s\"}\n", type);
  fflush(stdout);
}

/* ── Portal (D-Bus) ──────────────────────────────────────────────────────── */

struct screen {
  uint32_t node_id;
  int x, y, width, height; /* logical desktop coordinates */
};

struct request_wait {
  GMainLoop *loop;
  guint32 response;
  GVariant *results;
};

static void on_request_response(GDBusConnection *bus, const gchar *sender, const gchar *path,
                                const gchar *iface, const gchar *signal, GVariant *params,
                                gpointer user_data) {
  (void)bus; (void)sender; (void)path; (void)iface; (void)signal;
  struct request_wait *wait = user_data;
  g_variant_get(params, "(u@a{sv})", &wait->response, &wait->results);
  g_main_loop_quit(wait->loop);
}

static char *new_token(void) {
  static guint counter = 0;
  return g_strdup_printf("screenforge_%u_%u", (guint)getpid(), ++counter);
}

/*
 * Calls a portal method that answers through a Request object's Response
 * signal; `params` must carry handle_token = token. Returns the response code
 * (0 ok, 1 cancelled, 2 other) or -1 when the call itself failed.
 */
static int portal_request(GDBusConnection *bus, const char *method, GVariant *params,
                          const char *token, GVariant **results, GError **error) {
  char *sender = g_strdup(g_dbus_connection_get_unique_name(bus) + 1);
  for (char *p = sender; *p; p++) {
    if (*p == '.') *p = '_';
  }
  char *request_path = g_strdup_printf(PORTAL_PATH "/request/%s/%s", sender, token);
  g_free(sender);

  struct request_wait wait = { .loop = g_main_loop_new(NULL, FALSE), .response = 2 };
  guint subscription = g_dbus_connection_signal_subscribe(
      bus, PORTAL_BUS, REQUEST_IFACE, "Response", request_path, NULL,
      G_DBUS_SIGNAL_FLAGS_NO_MATCH_RULE, on_request_response, &wait, NULL);

  GVariant *reply = g_dbus_connection_call_sync(bus, PORTAL_BUS, PORTAL_PATH, SCREENCAST_IFACE,
                                                method, params, G_VARIANT_TYPE("(o)"),
                                                G_DBUS_CALL_FLAGS_NONE, -1, NULL, error);
  int result = -1;
  if (reply) {
    g_variant_unref(reply);
    g_main_loop_run(wait.loop);
    result = (int)wait.response;
    if (results) {
      *results = wait.results;
    } else if (wait.results) {
      g_variant_unref(wait.results);
    }
  }

  g_dbus_connection_signal_unsubscribe(bus, subscription);
  g_main_loop_unref(wait.loop);
  g_free(request_path);
  return result;
}

static guint32 available_cursor_modes(GDBusConnection *bus) {
  GVariant *reply = g_dbus_connection_call_sync(
      bus, PORTAL_BUS, PORTAL_PATH, "org.freedesktop.DBus.Properties", "Get",
      g_variant_new("(ss)", SCREENCAST_IFACE, "AvailableCursorModes"), G_VARIANT_TYPE("(v)"),
      G_DBUS_CALL_FLAGS_NONE, -1, NULL, NULL);
  if (!reply) return 0;
  GVariant *value = NULL;
  g_variant_get(reply, "(v)", &value);
  guint32 modes = g_variant_is_of_type(value, G_VARIANT_TYPE_UINT32) ? g_variant_get_uint32(value) : 0;
  g_variant_unref(value);
  g_variant_unref(reply);
  return modes;
}

/*
 * Asks the user for one screen. Returns the PipeWire fd (>= 0) and fills
 * `screen`; otherwise prints an error event and returns -1. `bus_out` keeps
 * the connection, whose lifetime is the session's.
 */
static int open_portal_session(struct screen *screen, GDBusConnection **bus_out) {
  GError *error = NULL;
  GDBusConnection *bus = g_bus_get_sync(G_BUS_TYPE_SESSION, NULL, &error);
  if (!bus) {
    emit_error("unsupported", error ? error->message : "No D-Bus session bus.");
    g_clear_error(&error);
    return -1;
  }
  *bus_out = bus;

  if (!(available_cursor_modes(bus) & CURSOR_MODE_METADATA)) {
    emit_error("unsupported", "The screen-share portal cannot keep the pointer apart.");
    return -1;
  }

  /* CreateSession */
  char *token = new_token();
  char *session_token = new_token();
  GVariantBuilder options;
  g_variant_builder_init(&options, G_VARIANT_TYPE_VARDICT);
  g_variant_builder_add(&options, "{sv}", "handle_token", g_variant_new_string(token));
  g_variant_builder_add(&options, "{sv}", "session_handle_token", g_variant_new_string(session_token));
  GVariant *results = NULL;
  char *session_handle = NULL;
  int response = portal_request(bus, "CreateSession", g_variant_new("(a{sv})", &options), token,
                                &results, &error);
  g_free(token);
  g_free(session_token);
  if (response != 0 || !results ||
      !g_variant_lookup(results, "session_handle", "s", &session_handle)) {
    emit_error("failed", error ? error->message : "Could not create a screen-share session.");
    g_clear_error(&error);
    if (results) g_variant_unref(results);
    return -1;
  }
  g_variant_unref(results);
  results = NULL;

  /* SelectSources: one screen, the pointer as metadata. */
  token = new_token();
  g_variant_builder_init(&options, G_VARIANT_TYPE_VARDICT);
  g_variant_builder_add(&options, "{sv}", "handle_token", g_variant_new_string(token));
  g_variant_builder_add(&options, "{sv}", "types", g_variant_new_uint32(SOURCE_TYPE_MONITOR));
  g_variant_builder_add(&options, "{sv}", "multiple", g_variant_new_boolean(FALSE));
  g_variant_builder_add(&options, "{sv}", "cursor_mode", g_variant_new_uint32(CURSOR_MODE_METADATA));
  response = portal_request(bus, "SelectSources",
                            g_variant_new("(oa{sv})", session_handle, &options), token, NULL,
                            &error);
  g_free(token);
  if (response != 0) {
    emit_error(response == 1 ? "cancelled" : "failed",
               error ? error->message : "Could not offer the screens to pick from.");
    g_clear_error(&error);
    g_free(session_handle);
    return -1;
  }

  /* Start: the share dialog. */
  token = new_token();
  g_variant_builder_init(&options, G_VARIANT_TYPE_VARDICT);
  g_variant_builder_add(&options, "{sv}", "handle_token", g_variant_new_string(token));
  response = portal_request(bus, "Start",
                            g_variant_new("(osa{sv})", session_handle, "", &options), token,
                            &results, &error);
  g_free(token);
  if (response != 0 || !results) {
    emit_error(response == 1 ? "cancelled" : "failed",
               error ? error->message : "The screen share did not start.");
    g_clear_error(&error);
    if (results) g_variant_unref(results);
    g_free(session_handle);
    return -1;
  }

  bool found = false;
  GVariant *streams = g_variant_lookup_value(results, "streams", G_VARIANT_TYPE("a(ua{sv})"));
  if (streams) {
    GVariantIter iter;
    guint32 node_id;
    GVariant *props;
    g_variant_iter_init(&iter, streams);
    if (g_variant_iter_next(&iter, "(u@a{sv})", &node_id, &props)) {
      screen->node_id = node_id;
      if (!g_variant_lookup(props, "position", "(ii)", &screen->x, &screen->y)) {
        screen->x = 0;
        screen->y = 0;
      }
      found = g_variant_lookup(props, "size", "(ii)", &screen->width, &screen->height) &&
              screen->width > 0 && screen->height > 0;
      g_variant_unref(props);
    }
    g_variant_unref(streams);
  }
  g_variant_unref(results);
  if (!found) {
    emit_error("failed", "The screen share did not include a screen.");
    g_free(session_handle);
    return -1;
  }

  /* OpenPipeWireRemote */
  GUnixFDList *fds = NULL;
  GVariantBuilder empty;
  g_variant_builder_init(&empty, G_VARIANT_TYPE_VARDICT);
  GVariant *reply = g_dbus_connection_call_with_unix_fd_list_sync(
      bus, PORTAL_BUS, PORTAL_PATH, SCREENCAST_IFACE, "OpenPipeWireRemote",
      g_variant_new("(oa{sv})", session_handle, &empty), G_VARIANT_TYPE("(h)"),
      G_DBUS_CALL_FLAGS_NONE, -1, NULL, &fds, NULL, &error);
  g_free(session_handle);
  if (!reply) {
    emit_error("failed", error ? error->message : "Could not open the screen share.");
    g_clear_error(&error);
    return -1;
  }
  gint32 handle = 0;
  g_variant_get(reply, "(h)", &handle);
  int fd = g_unix_fd_list_get(fds, handle, &error);
  g_variant_unref(reply);
  g_object_unref(fds);
  if (fd < 0) {
    emit_error("failed", error ? error->message : "Could not open the screen share.");
    g_clear_error(&error);
  }
  return fd;
}

/* ── Latest picture (written by the PipeWire thread, read by the writer) ─── */

static pthread_mutex_t frame_lock = PTHREAD_MUTEX_INITIALIZER;
static uint8_t *latest_frame;
static uint64_t frame_seq;
static uint32_t video_width, video_height;
static uint32_t video_format; /* spa_video_format */
static bool video_announced;

static size_t frame_bytes(void) {
  return (size_t)video_width * video_height * 4;
}

static const char *ffmpeg_pixel_format(uint32_t format) {
  switch (format) {
    case SPA_VIDEO_FORMAT_BGRx: return "bgr0";
    case SPA_VIDEO_FORMAT_RGBx: return "rgb0";
    case SPA_VIDEO_FORMAT_BGRA: return "bgra";
    case SPA_VIDEO_FORMAT_RGBA: return "rgba";
    default: return NULL;
  }
}

/* ── Recording: a writer thread feeds FFmpeg at a steady frame rate ──────── */

static pthread_mutex_t record_lock = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t record_cond;
static pthread_t writer_thread;
static bool recording, paused, stop_requested, write_failed;
static int ffmpeg_stdin = -1;
static pid_t ffmpeg_pid = -1;
static double frames_per_second;
static uint64_t frames_written, late_frames;
static struct timespec time_base, pause_started;
/* Signalled by the writer when FFmpeg stops taking frames; handled on the main loop. */
static struct pw_loop *loop_for_events;
static struct spa_source *writer_failed_event;

static double seconds_between(const struct timespec *from, const struct timespec *to) {
  return (double)(to->tv_sec - from->tv_sec) + (double)(to->tv_nsec - from->tv_nsec) / 1e9;
}

static struct timespec time_after(const struct timespec *base, double seconds) {
  struct timespec result = *base;
  double whole = floor(seconds);
  result.tv_sec += (time_t)whole;
  result.tv_nsec += (long)((seconds - whole) * 1e9);
  while (result.tv_nsec >= 1000000000L) {
    result.tv_sec++;
    result.tv_nsec -= 1000000000L;
  }
  return result;
}

static bool write_all(int fd, const uint8_t *data, size_t size) {
  while (size > 0) {
    ssize_t written = write(fd, data, size);
    if (written < 0) {
      if (errno == EINTR) continue;
      return false;
    }
    data += written;
    size -= (size_t)written;
  }
  return true;
}

/*
 * Frame n is due at time_base + n / fps. A pause moves time_base on by its
 * length, so paused time leaves no frames and the video stays in step with
 * the wall clock the pointer moves are timed by. A late writer catches up by
 * repeating the latest picture.
 */
static void *writer_main(void *unused) {
  (void)unused;
  pthread_mutex_lock(&frame_lock);
  size_t bytes = frame_bytes();
  pthread_mutex_unlock(&frame_lock);
  uint8_t *out = malloc(bytes);
  uint64_t copied_seq = UINT64_MAX;

  pthread_mutex_lock(&record_lock);
  if (!out) write_failed = true;
  while (out) {
    while (paused && !stop_requested) {
      pthread_cond_wait(&record_cond, &record_lock);
    }
    if (stop_requested) break;

    struct timespec due = time_after(&time_base, (double)frames_written / frames_per_second);
    struct timespec now;
    clock_gettime(CLOCK_MONOTONIC, &now);
    if (seconds_between(&now, &due) > 0) {
      pthread_cond_timedwait(&record_cond, &record_lock, &due);
      continue; /* re-check pause, stop and the time */
    }
    if (seconds_between(&due, &now) > 1.0 / frames_per_second) late_frames++;
    pthread_mutex_unlock(&record_lock);

    pthread_mutex_lock(&frame_lock);
    bool same_size = frame_bytes() == bytes;
    if (same_size && frame_seq != copied_seq) {
      memcpy(out, latest_frame, bytes);
      copied_seq = frame_seq;
    }
    pthread_mutex_unlock(&frame_lock);

    bool ok = same_size && write_all(ffmpeg_stdin, out, bytes);
    pthread_mutex_lock(&record_lock);
    if (!ok) {
      write_failed = true;
      if (writer_failed_event) pw_loop_signal_event(loop_for_events, writer_failed_event);
      break;
    }
    frames_written++;
  }
  pthread_mutex_unlock(&record_lock);
  free(out);
  return NULL;
}

static void start_recording(char **fields, int count) {
  if (recording) {
    emit_error("failed", "Already recording.");
    return;
  }
  if (count < 3 || !video_announced) {
    emit_error("failed", "Nothing to record yet.");
    return;
  }
  double fps = atof(fields[1]);
  if (!(fps >= 1 && fps <= 240)) {
    emit_error("failed", "Bad frame rate.");
    return;
  }

  char *ffmpeg_argv[MAX_FFMPEG_ARGS + 2];
  int ffmpeg_argc = 0;
  for (int i = 2; i < count && ffmpeg_argc < MAX_FFMPEG_ARGS; i++) {
    ffmpeg_argv[ffmpeg_argc++] = fields[i];
  }
  ffmpeg_argv[ffmpeg_argc] = NULL;

  int pipe_fds[2];
  if (pipe2(pipe_fds, O_CLOEXEC) != 0) {
    emit_error("failed", strerror(errno));
    return;
  }
  fcntl(pipe_fds[1], F_SETPIPE_SZ, 4 * 1024 * 1024); /* best effort: fewer wake-ups */

  posix_spawn_file_actions_t actions;
  posix_spawn_file_actions_init(&actions);
  posix_spawn_file_actions_adddup2(&actions, pipe_fds[0], STDIN_FILENO);
  posix_spawn_file_actions_addopen(&actions, STDOUT_FILENO, "/dev/null", O_WRONLY, 0);
  pid_t pid;
  int spawn_error = posix_spawn(&pid, ffmpeg_argv[0], &actions, NULL, ffmpeg_argv, environ);
  posix_spawn_file_actions_destroy(&actions);
  close(pipe_fds[0]);
  if (spawn_error != 0) {
    close(pipe_fds[1]);
    emit_error("failed", strerror(spawn_error));
    return;
  }

  ffmpeg_pid = pid;
  ffmpeg_stdin = pipe_fds[1];
  frames_per_second = fps;
  frames_written = 0;
  late_frames = 0;
  paused = false;
  stop_requested = false;
  write_failed = false;
  clock_gettime(CLOCK_MONOTONIC, &time_base);
  if (pthread_create(&writer_thread, NULL, writer_main, NULL) != 0) {
    close(ffmpeg_stdin);
    ffmpeg_stdin = -1;
    waitpid(ffmpeg_pid, NULL, 0);
    ffmpeg_pid = -1;
    emit_error("failed", "Could not start writing frames.");
    return;
  }
  recording = true;
  emit_simple("recording");
}

static void set_paused(bool pause) {
  if (!recording) return;
  pthread_mutex_lock(&record_lock);
  struct timespec now;
  clock_gettime(CLOCK_MONOTONIC, &now);
  if (pause && !paused) {
    paused = true;
    pause_started = now;
  } else if (!pause && paused) {
    time_base = time_after(&time_base, seconds_between(&pause_started, &now));
    paused = false;
  }
  pthread_cond_signal(&record_cond);
  pthread_mutex_unlock(&record_lock);
}

static void stop_recording(void) {
  if (!recording) return;
  recording = false;
  pthread_mutex_lock(&record_lock);
  stop_requested = true;
  pthread_cond_signal(&record_cond);
  pthread_mutex_unlock(&record_lock);
  pthread_join(writer_thread, NULL);

  close(ffmpeg_stdin);
  ffmpeg_stdin = -1;
  int status = 0;
  while (waitpid(ffmpeg_pid, &status, 0) < 0 && errno == EINTR) {
  }
  ffmpeg_pid = -1;
  bool ok = !write_failed && WIFEXITED(status) && WEXITSTATUS(status) == 0;
  printf("{\"type\":\"recorded\",\"ok\":%s,\"frames\":%" PRIu64 ",\"late\":%" PRIu64 "}\n",
         ok ? "true" : "false", frames_written, late_frames);
  fflush(stdout);
}

/* The current picture as raw BGRA, opaque. */
static void write_still(const char *path) {
  pthread_mutex_lock(&frame_lock);
  if (!video_announced || !latest_frame) {
    pthread_mutex_unlock(&frame_lock);
    emit_error("failed", "No picture yet.");
    return;
  }
  size_t bytes = frame_bytes();
  uint32_t width = video_width, height = video_height;
  bool swap = video_format == SPA_VIDEO_FORMAT_RGBx || video_format == SPA_VIDEO_FORMAT_RGBA;
  uint8_t *pixels = malloc(bytes);
  if (pixels) memcpy(pixels, latest_frame, bytes);
  pthread_mutex_unlock(&frame_lock);
  if (!pixels) {
    emit_error("failed", "Out of memory.");
    return;
  }

  for (size_t i = 0; i < bytes; i += 4) {
    if (swap) {
      uint8_t red = pixels[i];
      pixels[i] = pixels[i + 2];
      pixels[i + 2] = red;
    }
    pixels[i + 3] = 0xff;
  }
  /* Owner-only and never an existing file: it holds the whole screen. */
  int fd = open(path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
  FILE *file = fd < 0 ? NULL : fdopen(fd, "wb");
  if (fd >= 0 && !file) close(fd);
  bool ok = file && fwrite(pixels, 1, bytes, file) == bytes;
  if (file && fclose(file) != 0) ok = false;
  free(pixels);
  if (!ok) {
    emit_error("failed", "Could not save the picture.");
    return;
  }
  fputs("{\"type\":\"still\",\"path\":", stdout);
  print_json_string(path);
  printf(",\"width\":%u,\"height\":%u}\n", width, height);
  fflush(stdout);
}

/* ── PipeWire ────────────────────────────────────────────────────────────── */

static struct pw_main_loop *main_loop;
static struct pw_stream *stream;
static struct spa_hook stream_listener;
static struct screen shared_screen;
static bool quitting;
static double last_x = NAN, last_y = NAN;

static void quit(void) {
  if (quitting) return;
  quitting = true;
  stop_recording();
  pw_main_loop_quit(main_loop);
}

static void report_pointer(const struct spa_meta_cursor *cursor) {
  if (!cursor || !spa_meta_cursor_is_valid(cursor) || video_width == 0 || video_height == 0) {
    return;
  }
  double px = cursor->position.x;
  double py = cursor->position.y;
  /* Reported only while the pointer is on this screen. */
  if (px < 0 || py < 0 || px >= video_width || py >= video_height) return;
  double x = shared_screen.x + px * shared_screen.width / video_width;
  double y = shared_screen.y + py * shared_screen.height / video_height;
  if (x == last_x && y == last_y) return;
  last_x = x;
  last_y = y;
  printf("{\"type\":\"move\",\"x\":%.2f,\"y\":%.2f}\n", x, y);
  fflush(stdout);
}

static void keep_picture(const struct spa_buffer *buffer) {
  const struct spa_data *data = &buffer->datas[0];
  if (!data->data || !data->chunk || data->chunk->size == 0 ||
      (data->chunk->flags & SPA_CHUNK_FLAG_CORRUPTED) || video_width == 0 || video_height == 0) {
    return; /* a pointer-only update */
  }
  uint32_t row_bytes = video_width * 4;
  int32_t stride = data->chunk->stride > 0 ? data->chunk->stride : (int32_t)row_bytes;
  if ((size_t)stride < row_bytes ||
      (size_t)data->chunk->offset + (size_t)stride * (video_height - 1) + row_bytes >
          data->maxsize) {
    return;
  }
  const uint8_t *source = (const uint8_t *)data->data + data->chunk->offset;

  pthread_mutex_lock(&frame_lock);
  bool kept = latest_frame != NULL;
  if (kept) {
    for (uint32_t row = 0; row < video_height; row++) {
      memcpy(latest_frame + (size_t)row * row_bytes, source + (size_t)row * stride, row_bytes);
    }
    frame_seq++;
  }
  pthread_mutex_unlock(&frame_lock);

  if (kept && !video_announced) {
    video_announced = true;
    printf("{\"type\":\"video\",\"width\":%u,\"height\":%u,\"format\":\"%s\"}\n", video_width,
           video_height, ffmpeg_pixel_format(video_format));
    fflush(stdout);
  }
}

static void on_process(void *data) {
  (void)data;
  struct pw_buffer *buffer;
  while ((buffer = pw_stream_dequeue_buffer(stream)) != NULL) {
    report_pointer(spa_buffer_find_meta_data(buffer->buffer, SPA_META_Cursor,
                                             sizeof(struct spa_meta_cursor)));
    keep_picture(buffer->buffer);
    pw_stream_queue_buffer(stream, buffer);
  }
}

static void on_param_changed(void *data, uint32_t id, const struct spa_pod *param) {
  (void)data;
  if (param == NULL || id != SPA_PARAM_Format) return;

  uint32_t media_type, media_subtype;
  struct spa_video_info_raw info;
  if (spa_format_parse(param, &media_type, &media_subtype) < 0 ||
      media_type != SPA_MEDIA_TYPE_video || media_subtype != SPA_MEDIA_SUBTYPE_raw ||
      spa_format_video_raw_parse(param, &info) < 0 || !ffmpeg_pixel_format(info.format)) {
    return;
  }

  if (video_announced && (info.size.width != video_width || info.size.height != video_height ||
                          info.format != video_format)) {
    /* The screen changed size: what was recorded so far is kept. */
    fprintf(stderr, "screenforge-wayland-capture: the screen changed size\n");
    quit();
    emit_simple("ended");
    return;
  }

  pthread_mutex_lock(&frame_lock);
  video_width = info.size.width;
  video_height = info.size.height;
  video_format = info.format;
  free(latest_frame);
  latest_frame = calloc(frame_bytes(), 1);
  pthread_mutex_unlock(&frame_lock);

  uint8_t pod_buffer[1024];
  struct spa_pod_builder builder = SPA_POD_BUILDER_INIT(pod_buffer, sizeof(pod_buffer));
  const struct spa_pod *params[2];
  params[0] = spa_pod_builder_add_object(
      &builder, SPA_TYPE_OBJECT_ParamMeta, SPA_PARAM_Meta, SPA_PARAM_META_type,
      SPA_POD_Id(SPA_META_Cursor), SPA_PARAM_META_size,
      SPA_POD_CHOICE_RANGE_Int(CURSOR_META_SIZE(64, 64), CURSOR_META_SIZE(1, 1),
                               CURSOR_META_SIZE(512, 512)));
  params[1] = spa_pod_builder_add_object(
      &builder, SPA_TYPE_OBJECT_ParamBuffers, SPA_PARAM_Buffers, SPA_PARAM_BUFFERS_dataType,
      SPA_POD_CHOICE_FLAGS_Int((1 << SPA_DATA_MemFd) | (1 << SPA_DATA_MemPtr)));
  pw_stream_update_params(stream, params, 2);
}

/* FFmpeg stopped taking frames: finish (reported as not ok) and end, so the app stops too. */
static void on_writer_failed(void *data, uint64_t count) {
  (void)data; (void)count;
  if (quitting || !recording) return;
  fprintf(stderr, "screenforge-wayland-capture: the encoder stopped taking frames\n");
  quit();
  emit_simple("ended");
}

static void on_state_changed(void *data, enum pw_stream_state old, enum pw_stream_state state,
                             const char *error) {
  (void)data; (void)old;
  /* The share ended from outside (stopped from the system, screen gone). */
  if (!quitting && (state == PW_STREAM_STATE_ERROR || state == PW_STREAM_STATE_UNCONNECTED)) {
    if (error) fprintf(stderr, "screenforge-wayland-capture: share stopped: %s\n", error);
    quit();
    emit_simple("ended");
  }
}

static const struct pw_stream_events stream_events = {
  PW_VERSION_STREAM_EVENTS,
  .state_changed = on_state_changed,
  .param_changed = on_param_changed,
  .process = on_process,
};

/* ── Commands on stdin ───────────────────────────────────────────────────── */

static void run_command(char *line) {
  char *fields[MAX_FFMPEG_ARGS + 4];
  int count = 0;
  char *saved = NULL;
  for (char *field = strtok_r(line, "\t", &saved); field && count < (int)G_N_ELEMENTS(fields);
       field = strtok_r(NULL, "\t", &saved)) {
    fields[count++] = field;
  }
  if (count == 0) return;

  if (strcmp(fields[0], "record") == 0) {
    start_recording(fields, count);
  } else if (strcmp(fields[0], "pause") == 0) {
    set_paused(true);
  } else if (strcmp(fields[0], "resume") == 0) {
    set_paused(false);
  } else if (strcmp(fields[0], "stop") == 0) {
    stop_recording();
  } else if (strcmp(fields[0], "still") == 0 && count == 2) {
    write_still(fields[1]);
  } else {
    emit_error("failed", "Unknown command.");
  }
}

static char command_buffer[64 * 1024];
static size_t command_length;

static void on_stdin(void *data, int fd, uint32_t mask) {
  (void)data; (void)mask;
  ssize_t got = read(fd, command_buffer + command_length,
                     sizeof(command_buffer) - 1 - command_length);
  if (got <= 0) {
    if (got < 0 && errno == EINTR) return;
    quit(); /* the app went away */
    return;
  }
  command_length += (size_t)got;
  command_buffer[command_length] = '\0';

  char *start = command_buffer;
  char *newline;
  while (!quitting && (newline = strchr(start, '\n')) != NULL) {
    *newline = '\0';
    run_command(start);
    start = newline + 1;
  }
  command_length = strlen(start);
  memmove(command_buffer, start, command_length + 1);
  if (command_length == sizeof(command_buffer) - 1) command_length = 0; /* runaway line */
}

static void on_quit_signal(void *data, int signal_number) {
  (void)data; (void)signal_number;
  quit();
}

int main(int argc, char **argv) {
  signal(SIGPIPE, SIG_IGN); /* a dead FFmpeg shows up as a failed write */

  pthread_condattr_t cond_attr;
  pthread_condattr_init(&cond_attr);
  pthread_condattr_setclock(&cond_attr, CLOCK_MONOTONIC);
  pthread_cond_init(&record_cond, &cond_attr);

  GDBusConnection *bus = NULL;
  int pipewire_fd = open_portal_session(&shared_screen, &bus);
  if (pipewire_fd < 0) return 1;

  printf("{\"type\":\"ready\",\"screen\":{\"x\":%d,\"y\":%d,\"width\":%d,\"height\":%d}}\n",
         shared_screen.x, shared_screen.y, shared_screen.width, shared_screen.height);
  fflush(stdout);

  pw_init(&argc, &argv);
  main_loop = pw_main_loop_new(NULL);
  struct pw_loop *loop = pw_main_loop_get_loop(main_loop);
  pw_loop_add_signal(loop, SIGINT, on_quit_signal, NULL);
  pw_loop_add_signal(loop, SIGTERM, on_quit_signal, NULL);
  pw_loop_add_io(loop, STDIN_FILENO, SPA_IO_IN | SPA_IO_HUP | SPA_IO_ERR, false, on_stdin, NULL);
  loop_for_events = loop;
  writer_failed_event = pw_loop_add_event(loop, on_writer_failed, NULL);

  struct pw_context *context = pw_context_new(loop, NULL, 0);
  struct pw_core *core = context ? pw_context_connect_fd(context, pipewire_fd, NULL, 0) : NULL;
  if (!core) {
    emit_error("failed", "Could not connect to PipeWire.");
    return 1;
  }

  stream = pw_stream_new(core, "Screenforge screen",
                         pw_properties_new(PW_KEY_MEDIA_TYPE, "Video", PW_KEY_MEDIA_CATEGORY,
                                           "Capture", PW_KEY_MEDIA_ROLE, "Screen", NULL));
  if (!stream) {
    emit_error("failed", "Could not follow the shared screen.");
    return 1;
  }
  pw_stream_add_listener(stream, &stream_listener, &stream_events, NULL);

  uint8_t pod_buffer[1024];
  struct spa_pod_builder builder = SPA_POD_BUILDER_INIT(pod_buffer, sizeof(pod_buffer));
  const struct spa_pod *params[1];
  params[0] = spa_pod_builder_add_object(
      &builder, SPA_TYPE_OBJECT_Format, SPA_PARAM_EnumFormat, SPA_FORMAT_mediaType,
      SPA_POD_Id(SPA_MEDIA_TYPE_video), SPA_FORMAT_mediaSubtype, SPA_POD_Id(SPA_MEDIA_SUBTYPE_raw),
      SPA_FORMAT_VIDEO_format,
      SPA_POD_CHOICE_ENUM_Id(5, SPA_VIDEO_FORMAT_BGRx, SPA_VIDEO_FORMAT_BGRx,
                             SPA_VIDEO_FORMAT_RGBx, SPA_VIDEO_FORMAT_BGRA, SPA_VIDEO_FORMAT_RGBA),
      SPA_FORMAT_VIDEO_size,
      SPA_POD_CHOICE_RANGE_Rectangle(&SPA_RECTANGLE(1920, 1080), &SPA_RECTANGLE(1, 1),
                                     &SPA_RECTANGLE(16384, 16384)),
      SPA_FORMAT_VIDEO_framerate,
      SPA_POD_CHOICE_RANGE_Fraction(&SPA_FRACTION(60, 1), &SPA_FRACTION(0, 1),
                                    &SPA_FRACTION(240, 1)));
  if (pw_stream_connect(stream, PW_DIRECTION_INPUT, shared_screen.node_id,
                        PW_STREAM_FLAG_AUTOCONNECT | PW_STREAM_FLAG_MAP_BUFFERS, params, 1) != 0) {
    emit_error("failed", "Could not follow the shared screen.");
    return 1;
  }

  pw_main_loop_run(main_loop);

  pw_stream_destroy(stream);
  pw_core_disconnect(core);
  pw_context_destroy(context);
  pw_main_loop_destroy(main_loop);
  g_object_unref(bus);
  free(latest_frame);
  pw_deinit();
  return 0;
}
