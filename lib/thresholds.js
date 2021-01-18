import assert from "assert";

export default function thresholds(cmd) {
  if (cmd === "clone") {
    return {
      "ving objects:   0%": 0,
      "ving objects:   1%": 1,
      "ving objects:   6%": 5,
      "ving objects:  12%": 10,
      "ving objects:  25%": 20,
      "ving objects:  50%": 40,
      "ving objects:  75%": 60,
      "deltas:   0%": 80,
      "deltas:  50%": 90,
    };
  } else {
    assert(false);
  }
}
