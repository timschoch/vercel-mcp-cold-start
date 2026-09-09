# Lessons

- Before adding a setting, run the deletion test on what it configures. 0.4.0
  added `path` to `createFront` where the mount already decided the route; the
  setting could only agree with it or answer 404.
