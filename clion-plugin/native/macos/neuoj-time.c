#include <errno.h>
#include <libproc.h>
#include <mach/mach_time.h>
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

static int write_result(const char *path, const char *state, int value, uint64_t cpu_us, uint64_t wall_us) {
  FILE *file = fopen(path, "wx");
  if (file == NULL) return 74;
  int written = fprintf(file, "neuoj-time-v2\n%s=%d\ncpu_us=%llu\nwall_us=%llu\n", state, value,
    (unsigned long long)cpu_us, (unsigned long long)wall_us);
  int closed = fclose(file);
  if (written < 0 || closed != 0) return 74;
  return 0;
}

static uint64_t elapsed_ns(uint64_t start, uint64_t end, mach_timebase_info_data_t base) {
  return (end - start) * base.numer / base.denom;
}

int main(int argc, char **argv) {
  if (argc < 4) return 64;
  char *end = NULL;
  errno = 0;
  unsigned long long timeout_ms = strtoull(argv[2], &end, 10);
  if (errno != 0 || end == argv[2] || *end != '\0' || timeout_ms > 300000) return 64;
  mach_timebase_info_data_t base;
  if (mach_timebase_info(&base) != KERN_SUCCESS || base.denom == 0) return 74;
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

  pid_t child = 0;
  int error = posix_spawn(&child, argv[3], NULL, &attributes, &argv[3], environ);
  posix_spawnattr_destroy(&attributes);
  if (error != 0) return write_result(argv[1], "spawn_error", error, 0, 0);

  uint64_t start = 0;
  const uint64_t limit_ns = timeout_ms * 1000000ULL;
  const struct timespec interval = {.tv_sec = 0, .tv_nsec = 1000000};
  siginfo_t info = {0};
  while (1) {
    if (stop_requested) {
      kill_child_group(child);
      wait4(child, NULL, 0, NULL);
      return 74;
    }
    if (waitid(P_PID, child, &info, WEXITED | WNOWAIT | WNOHANG) != 0) {
      if (errno == EINTR) continue;
      kill_child_group(child);
      wait4(child, NULL, 0, NULL);
      return 74;
    }
    if (info.si_pid == child) break;
    if (start == 0) {
      struct rusage_info_v0 current = {0};
      if (proc_pid_rusage(child, RUSAGE_INFO_V0, (rusage_info_t *)&current) == 0)
        start = current.ri_proc_start_abstime;
    }
    if (start != 0 && elapsed_ns(start, mach_absolute_time(), base) >= limit_ns) {
      kill_child_group(child);
      while (waitid(P_PID, child, &info, WEXITED | WNOWAIT) != 0) {
        if (errno != EINTR) { wait4(child, NULL, 0, NULL); return 74; }
      }
      break;
    }
    nanosleep(&interval, NULL);
  }

  struct rusage_info_v0 wall = {0};
  if (proc_pid_rusage(child, RUSAGE_INFO_V0, (rusage_info_t *)&wall) != 0 ||
      wall.ri_proc_start_abstime == 0 || wall.ri_proc_exit_abstime < wall.ri_proc_start_abstime) {
    wait4(child, NULL, 0, NULL);
    return 74;
  }
  uint64_t wall_ns = elapsed_ns(wall.ri_proc_start_abstime, wall.ri_proc_exit_abstime, base);

  int status = 0;
  struct rusage usage = {0};
  while (wait4(child, &status, 0, &usage) < 0) {
    if (errno == EINTR) continue;
    return 74;
  }

  uint64_t cpu_us = (uint64_t)(usage.ru_utime.tv_sec + usage.ru_stime.tv_sec) * 1000000ULL +
    (uint64_t)usage.ru_utime.tv_usec + (uint64_t)usage.ru_stime.tv_usec;
  uint64_t wall_us = wall_ns / 1000;
  if (wall_ns >= limit_ns) {
    int exit_code = WIFEXITED(status) ? WEXITSTATUS(status) :
      WIFSIGNALED(status) ? 128 + WTERMSIG(status) : 255;
    return write_result(argv[1], "timeout", exit_code, cpu_us, wall_us);
  }
  if (WIFEXITED(status)) return write_result(argv[1], "exit", WEXITSTATUS(status), cpu_us, wall_us);
  if (WIFSIGNALED(status)) return write_result(argv[1], "signal", WTERMSIG(status), cpu_us, wall_us);
  return 74;
}
