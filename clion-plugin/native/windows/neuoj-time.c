#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif
#include <windows.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <wchar.h>

static uint64_t filetime_ticks(FILETIME time) {
  return ((uint64_t)time.dwHighDateTime << 32) | time.dwLowDateTime;
}

static int write_result(const wchar_t *path, const char *state, DWORD value, uint64_t cpu_us, uint64_t wall_us) {
  HANDLE file = CreateFileW(path, GENERIC_WRITE, 0, NULL, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, NULL);
  if (file == INVALID_HANDLE_VALUE) return 74;
  char output[128];
  int length = snprintf(output, sizeof(output), "neuoj-time-v2\n%s=%lu\ncpu_us=%llu\nwall_us=%llu\n", state,
    (unsigned long)value, (unsigned long long)cpu_us, (unsigned long long)wall_us);
  DWORD written = 0;
  BOOL ok = length > 0 && length < (int)sizeof(output) &&
    WriteFile(file, output, (DWORD)length, &written, NULL) && written == (DWORD)length;
  if (!CloseHandle(file)) ok = FALSE;
  return ok ? 0 : 74;
}

static wchar_t *quote_arguments(int argc, wchar_t **argv) {
  size_t capacity = 1;
  for (int i = 3; i < argc; ++i) capacity += wcslen(argv[i]) * 2 + 4;
  if (capacity > 32767) return NULL;
  wchar_t *command = calloc(capacity, sizeof(wchar_t));
  if (command == NULL) return NULL;
  wchar_t *out = command;
  for (int i = 3; i < argc; ++i) {
    if (i > 3) *out++ = L' ';
    *out++ = L'"';
    const wchar_t *part = argv[i];
    while (*part != L'\0') {
      size_t slashes = 0;
      while (*part == L'\\') { ++slashes; ++part; }
      if (*part == L'"' || *part == L'\0') {
        for (size_t j = 0; j < slashes * 2; ++j) *out++ = L'\\';
        if (*part == L'"') { *out++ = L'\\'; *out++ = *part++; }
      } else {
        for (size_t j = 0; j < slashes; ++j) *out++ = L'\\';
        *out++ = *part++;
      }
    }
    *out++ = L'"';
  }
  *out = L'\0';
  return command;
}

int wmain(int argc, wchar_t **argv) {
  if (argc < 4) return 64;
  wchar_t *end = NULL;
  unsigned long timeout_ms = wcstoul(argv[2], &end, 10);
  if (end == argv[2] || *end != L'\0' || timeout_ms > 300000) return 64;
  wchar_t *command = quote_arguments(argc, argv);
  if (command == NULL) return 74;

  DWORD standard_ids[3] = {STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE};
  HANDLE inherited[3] = {NULL, NULL, NULL};
  for (int i = 0; i < 3; ++i) {
    HANDLE original = GetStdHandle(standard_ids[i]);
    if (original == NULL || original == INVALID_HANDLE_VALUE ||
        !DuplicateHandle(GetCurrentProcess(), original, GetCurrentProcess(), &inherited[i],
          0, TRUE, DUPLICATE_SAME_ACCESS)) {
      DWORD error = GetLastError();
      for (int j = 0; j <= i; ++j) if (inherited[j] != NULL) CloseHandle(inherited[j]);
      free(command);
      return write_result(argv[1], "spawn_error", error != 0 ? error : ERROR_INVALID_HANDLE, 0, 0);
    }
  }
  STARTUPINFOW startup = {0};
  startup.cb = sizeof(startup);
  startup.dwFlags = STARTF_USESTDHANDLES;
  startup.hStdInput = inherited[0];
  startup.hStdOutput = inherited[1];
  startup.hStdError = inherited[2];
  PROCESS_INFORMATION process = {0};
  BOOL created = CreateProcessW(argv[3], command, NULL, NULL, TRUE,
    CREATE_SUSPENDED | CREATE_NO_WINDOW, NULL, NULL, &startup, &process);
  DWORD spawn_error = created ? 0 : GetLastError();
  for (int i = 0; i < 3; ++i) CloseHandle(inherited[i]);
  free(command);
  if (!created) return write_result(argv[1], "spawn_error", spawn_error, 0, 0);

  HANDLE job = CreateJobObjectW(NULL, NULL);
  if (job != NULL) {
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = {0};
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits)) ||
        !AssignProcessToJobObject(job, process.hProcess)) {
      CloseHandle(job);
      job = NULL;
    }
  }

  if (ResumeThread(process.hThread) == (DWORD)-1) {
    if (job != NULL) TerminateJobObject(job, 137);
    else TerminateProcess(process.hProcess, 137);
    WaitForSingleObject(process.hProcess, INFINITE);
    if (job != NULL) CloseHandle(job);
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    return 74;
  }
  FILETIME resumed_at;
  GetSystemTimePreciseAsFileTime(&resumed_at);
  CloseHandle(process.hThread);

  DWORD wait = WaitForSingleObject(process.hProcess, (DWORD)timeout_ms);
  BOOL timed_out = FALSE;
  if (wait == WAIT_TIMEOUT) wait = WaitForSingleObject(process.hProcess, 0);
  if (wait == WAIT_TIMEOUT) {
    timed_out = TRUE;
    if (job != NULL) TerminateJobObject(job, 137);
    else TerminateProcess(process.hProcess, 137);
    wait = WaitForSingleObject(process.hProcess, INFINITE);
  }
  if (wait == WAIT_FAILED) {
    if (job != NULL) TerminateJobObject(job, 137);
    else TerminateProcess(process.hProcess, 137);
    WaitForSingleObject(process.hProcess, INFINITE);
  }
  FILETIME created_at, exited_at, kernel, user;
  DWORD exit_code = 0;
  BOOL valid = wait == WAIT_OBJECT_0 &&
    GetProcessTimes(process.hProcess, &created_at, &exited_at, &kernel, &user) &&
    GetExitCodeProcess(process.hProcess, &exit_code);
  int result = 74;
  if (valid) {
    uint64_t exited_ticks = filetime_ticks(exited_at);
    uint64_t resumed_ticks = filetime_ticks(resumed_at);
    if (exited_ticks >= filetime_ticks(created_at)) {
      uint64_t cpu_us = (filetime_ticks(kernel) + filetime_ticks(user)) / 10;
      uint64_t wall_us = exited_ticks > resumed_ticks ? (exited_ticks - resumed_ticks) / 10 : 0;
      result = write_result(argv[1], timed_out || wall_us >= (uint64_t)timeout_ms * 1000ULL ? "timeout" : "exit",
        exit_code, cpu_us, wall_us);
    }
  }
  if (job != NULL) CloseHandle(job);
  CloseHandle(process.hProcess);
  return result;
}
