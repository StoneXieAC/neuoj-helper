#define _GNU_SOURCE
#include <errno.h>
#include <signal.h>
#include <spawn.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

extern char **environ;
static volatile sig_atomic_t stop_requested = 0;

static void request_stop(int signal_number) {
  (void)signal_number;
  stop_requested = 1;
}

static void kill_child_group(pid_t child) {
  if (kill(-child, SIGKILL) != 0) kill(child, SIGKILL);
}

static uint64_t monotonic_us(void) {
  struct timespec now;
  if (clock_gettime(CLOCK_MONOTONIC, &now) != 0) return 0;
  return (uint64_t)now.tv_sec * 1000000ULL + (uint64_t)now.tv_nsec / 1000ULL;
}

static int write_result(const char *path, const char *state, int value, uint64_t cpu_us, uint64_t wall_us) {
  FILE *file = fopen(path, "wx");
  if (file == NULL) return 74;
  int written = fprintf(file, "neuoj-time-v2\n%s=%d\ncpu_us=%llu\nwall_us=%llu\n", state, value,
    (unsigned long long)cpu_us, (unsigned long long)wall_us);
  int closed = fclose(file);
  return written < 0 || closed != 0 ? 74 : 0;
}

int main(int argc, char **argv) {
  if (argc < 4) return 64;
  char *end = NULL;
  errno = 0;
  unsigned long long timeout_ms = strtoull(argv[2], &end, 10);
  if (errno != 0 || end == argv[2] || *end != '\0' || timeout_ms > 300000) return 64;
  struct sigaction action = {.sa_handler = request_stop};
  sigemptyset(&action.sa_mask);
  if (sigaction(SIGTERM, &action, NULL) != 0) return 74;

  posix_spawnattr_t attributes;
  if (posix_spawnattr_init(&attributes) != 0) return 74;
  if (posix_spawnattr_setflags(&attributes, POSIX_SPAWN_SETPGROUP) != 0 ||
      posix_spawnattr_setpgroup(&attributes, 0) != 0) {
    posix_spawnattr_destroy(&attributes);
    return 74;
  }

  uint64_t started = monotonic_us();
  if (started == 0) { posix_spawnattr_destroy(&attributes); return 74; }
  pid_t child = 0;
  int error = posix_spawn(&child, argv[3], NULL, &attributes, &argv[3], environ);
  posix_spawnattr_destroy(&attributes);
  if (error != 0) return write_result(argv[1], "spawn_error", error, 0, 0);

  const uint64_t limit_us = timeout_ms * 1000ULL;
  const struct timespec interval = {.tv_sec = 0, .tv_nsec = 1000000};
  siginfo_t info = {0};
  uint64_t observed_end = 0;
  int killed_for_timeout = 0;
  while (1) {
    if (stop_requested) {
      kill_child_group(child);
      wait4(child, NULL, 0, NULL);
      return 74;
    }
    info.si_pid = 0;
    if (waitid(P_PID, child, &info, WEXITED | WNOWAIT | WNOHANG) != 0) {
      if (errno == EINTR) continue;
      kill_child_group(child);
      wait4(child, NULL, 0, NULL);
      return 74;
    }
    observed_end = monotonic_us();
    if (observed_end == 0) { kill_child_group(child); wait4(child, NULL, 0, NULL); return 74; }
    if (info.si_pid == child) break;
    if (observed_end - started >= limit_us) {
      killed_for_timeout = 1;
      kill_child_group(child);
      break;
    }
    nanosleep(&interval, NULL);
  }

  // 主进程仍未被回收，进程组 ID 不会被其他进程复用。
  if (!killed_for_timeout) kill(-child, SIGKILL);
  int status = 0;
  struct rusage usage = {0};
  while (wait4(child, &status, 0, &usage) < 0) {
    if (errno == EINTR) continue;
    return 74;
  }
  uint64_t cpu_us = (uint64_t)usage.ru_utime.tv_sec * 1000000ULL + (uint64_t)usage.ru_utime.tv_usec +
    (uint64_t)usage.ru_stime.tv_sec * 1000000ULL + (uint64_t)usage.ru_stime.tv_usec;
  uint64_t wall_us = observed_end - started;
  if (killed_for_timeout || limit_us == 0) {
    int code = WIFEXITED(status) ? WEXITSTATUS(status) : WIFSIGNALED(status) ? 128 + WTERMSIG(status) : 255;
    return write_result(argv[1], "timeout", code, cpu_us, wall_us);
  }
  if (WIFEXITED(status)) return write_result(argv[1], "exit", WEXITSTATUS(status), cpu_us, wall_us);
  if (WIFSIGNALED(status)) return write_result(argv[1], "signal", WTERMSIG(status), cpu_us, wall_us);
  return 74;
}
