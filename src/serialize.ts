function isT<T>(x: any): x is T {
  return true;
}

function isPrimitive(x: any): x is number|string|symbol {
  return typeof x === 'string' || typeof x === 'number' ||
      x instanceof String || x instanceof Number
}

const find = <T>(test: (x: any) => x is T) => (acc: T[], obj: any): T[] => {
  if (test(obj)) {
    return acc.concat(obj)
  } else if (Array.isArray(obj)) {
    return obj.reduce(find(test), acc)
  } else if (isPrimitive(obj)) {
    return acc;  // test already was false
  } else {
    return Object.keys(obj).map(k => obj[k]).reduce(find(test), acc);
  }
};

type Opaques = number|string|symbol;

type Key = string|number|symbol;

const oj = {
  x: {a: 'hello', b: 'hello'},
  z: 'hello'
}

type Tobj = typeof oj;

type TobjPth = PathTraced<Tobj, []>;

const tracePath = (acc: (string|number|symbol)[], obj: any): any => {
  if (Array.isArray(obj)) {
    const accp = acc.concat(1);
    return obj.map((x, i) => tracePath(accp, x));
  }
};
