import type { TranslationServiceAdapter } from "../shared/translation";

export interface ProviderRuntimeManager<T extends { readonly adapter: TranslationServiceAdapter }> {
  current(): T;
  create(adapter: TranslationServiceAdapter): T;
  publish(runtime: T): boolean;
}

/**
 * A runtime binds every scheduler and message handler to one immutable concrete
 * adapter. Publishing a new runtime never changes an old runtime's adapter,
 * preventing a provider switch from retargeting a task mid-flight.
 */
export function createProviderRuntimeManager<T extends { readonly adapter: TranslationServiceAdapter }>({
  fake,
  baidu,
  create,
}: {
  fake: TranslationServiceAdapter & { id: "fake" };
  baidu: TranslationServiceAdapter & { id: "baidu" };
  create(adapter: TranslationServiceAdapter): T;
}): ProviderRuntimeManager<T> {
  const supported = new Set<TranslationServiceAdapter>([fake, baidu]);
  const build = (adapter: TranslationServiceAdapter): T => create(adapter);
  let active = build(fake);

  return {
    current: () => active,
    create(adapter) {
      if (!supported.has(adapter)) throw new Error("Unsupported translation adapter runtime");
      return build(adapter);
    },
    publish(runtime) {
      if (active.adapter === runtime.adapter) return false;
      active = runtime;
      return true;
    },
  };
}
