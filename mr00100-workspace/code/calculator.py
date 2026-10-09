def add(a, b):
    return a + b

def sub(a, b):
    return a - b

def mul(a, b):
    return a * b

def div(a, b):
    if b == 0:
        raise ZeroDivisionError("cannot divide by zero")
    return a / b


if __name__ == "__main__":
    print("MR00100 calculator")
    print("add 2+3 =", add(2, 3))
    print("sub 9-4 =", sub(9, 4))
    print("mul 6*7 =", mul(6, 7))
    print("div 8/2 =", div(8, 2))
