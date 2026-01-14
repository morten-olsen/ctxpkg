const destroy = Symbol('destroy');
const instanceKey = Symbol('instances');

type ServiceDependency<T> = new (services: Services) => T & {
  [destroy]?: () => Promise<void> | void;
};

class Services {
  [instanceKey]: Map<ServiceDependency<unknown>, unknown>;

  constructor() {
    this[instanceKey] = new Map();
  }

  public get = <T>(service: ServiceDependency<T>) => {
    if (!this[instanceKey].has(service)) {
      this[instanceKey].set(service, new service(this));
    }
    const instance = this[instanceKey].get(service);
    if (!instance) {
      throw new Error('Could not generate instance');
    }
    return instance as T;
  };

  public set = <T>(service: ServiceDependency<T>, instance: Partial<T>) => {
    this[instanceKey].set(service, instance);
  };

  public destroy = async () => {
    await Promise.all(
      Array.from(this[instanceKey].values()).map(async (instance) => {
        if (
          typeof instance === 'object' &&
          instance &&
          destroy in instance &&
          typeof instance[destroy] === 'function'
        ) {
          await instance[destroy]();
        }
      }),
    );
  };
}

export { Services, destroy };
