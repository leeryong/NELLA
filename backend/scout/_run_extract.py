"""Cython .so 로 컴파일된 a_extract_tcm_10pct 의 main() 을 실행하는 런처.
호출: python -m backend.scout._run_extract --input-jsonl ... --target-name ...
"""
from backend.scout.a_extract_tcm_10pct import main

if __name__ == "__main__":
    main()
