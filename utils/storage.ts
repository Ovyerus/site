export type LocalStorageEventDetail = {
  oldValue: any;
  newValue: any;
  key: string;
};

export const get = (key: string) => localStorage.getItem(key);

export const set = (key: string, value: any) => {
  const oldValue = localStorage.getItem(key);
  const event = new CustomEvent<LocalStorageEventDetail>('localStorage', {
    detail: { oldValue, newValue: value, key }
  });

  localStorage.setItem(key, value);
  window.dispatchEvent(event);
};

export const storage = { get, set };
