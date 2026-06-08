"""Cython .so 로 컴파일된 c_prediction 의 main() 을 실행하는 런처."""
from backend.scout.c_prediction import main

if __name__ == "__main__":
    main()
