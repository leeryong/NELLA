"""Launcher for the scout `b_resample_tcm_25bins` step.

Kept as plain source (never obfuscated) so `python _run_resample.py ...` runs whether
the step module is a .py or a Cython-compiled .so. It puts the project root on
sys.path, then imports and runs the module's main(); argparse reads the args
that follow.
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from backend.scout.b_resample_tcm_25bins import main

if __name__ == "__main__":
    main()
