/* parent.c — a constructed harness parent for relay's Darwin probe.
 *
 * `parent CMD [ARGS...]` runs CMD as its child, waits for it, then blocks until the probe
 * kills its process group. Installed under a harness's name (codex, claude, 9.9.9), it is the
 * live ancestor relay's adapter looks for. It is compiled on the host: macOS refuses to launch
 * a copy of an Apple platform binary such as /bin/sh from /tmp.
 *
 * Exit 127 with one line on stderr when fork or exec fails; otherwise it never exits. */
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

static int fail(const char *self, const char *what, int err) {
  fprintf(stderr, "%s: %s: %s\n", self, what, strerror(err));
  return 127;
}

int main(int argc, char **argv) {
  if (argc < 2) { fprintf(stderr, "usage: %s CMD [ARGS...]\n", argv[0]); return 127; }
  /* The child reports a failed exec through this pipe; a successful exec closes it. */
  int report[2];
  if (pipe(report) != 0) return fail(argv[0], "pipe", errno);
  fcntl(report[1], F_SETFD, FD_CLOEXEC);
  pid_t pid = fork();
  if (pid < 0) return fail(argv[0], "fork", errno);
  if (pid == 0) {
    close(report[0]);
    execvp(argv[1], argv + 1);
    int err = errno;
    (void)!write(report[1], &err, sizeof err);
    _exit(127);
  }
  close(report[1]);
  int err;
  ssize_t n;
  while ((n = read(report[0], &err, sizeof err)) < 0 && errno == EINTR) {}
  close(report[0]);
  if (n == (ssize_t)sizeof err) return fail(argv[0], argv[1], err);
  while (waitpid(pid, NULL, 0) < 0 && errno == EINTR) {}
  for (;;) pause();
}
