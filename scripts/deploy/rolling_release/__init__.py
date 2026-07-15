"""Single-coordinator deployment implementation.

The public entry point remains ``scripts/deploy/rolling-release.py``.  Modules
in this package keep policy, persistence, and execution boundaries explicit so
the entry point does not grow another coordinator implementation.
"""
