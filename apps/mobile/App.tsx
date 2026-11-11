import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Linking from "expo-linking";
import * as Notifications from "expo-notifications";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, BackHandler, Platform, SafeAreaView, StyleSheet } from "react-native";
import { WebView } from "react-native-webview";

/**
 * Truman's app: a native shell around the participant site (ADR 66). It gives the site a place on
 * the home screen, keeps people signed in, and adds what only an app can: push notifications, and
 * knowing when it's opened and closed. Everything else, and everything about who someone is, stays
 * with the site and its session. The app tells the site what it knows through "truman-app" events
 * (apps/participant/src/app-bridge.ts), and the site sends it to the API.
 */

const SITE_URL: string = (Constants.expoConfig?.extra?.siteUrl as string) ?? "";
const PLATFORM = Platform.OS === "ios" ? "ios" : "android";

/** Shows a push notification even when the app is open, as other apps do. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

type AppMessage =
  | { type: "push-token"; token: string; platform: "ios" | "android" }
  | { type: "push-permission"; granted: boolean }
  | { type: "opened"; platform: "ios" | "android" }
  | { type: "closed"; secondsOpen: number }
  | { type: "push-opened"; kind: "notification" | "message" };

/** Before the site loads: where the app's messages wait until the site is ready for them. */
const BEFORE_LOAD = `
  window.trumanApp = { platform: ${JSON.stringify(PLATFORM)} };
  window.trumanAppQueue = window.trumanAppQueue || [];
  true;
`;

/** Hands a message to the site, or leaves it waiting if the site hasn't started listening. */
const deliver = (message: AppMessage) => `
  (function (message) {
    if (window.trumanAppReady) {
      window.dispatchEvent(new CustomEvent("truman-app", { detail: message }));
    } else {
      (window.trumanAppQueue = window.trumanAppQueue || []).push(message);
    }
  })(${JSON.stringify(message)});
  true;
`;

/** The site's address for a link into the app, like commons://join/bystander?PROLIFIC_PID=1. */
function pageFor(url: string | null): string | null {
  if (!url) {
    return null;
  }
  if (url.startsWith(SITE_URL)) {
    return url;
  }
  const { path, queryParams } = Linking.parse(url);
  if (!path) {
    return null;
  }
  const query = new URLSearchParams(
    Object.entries(queryParams ?? {}).flatMap(([key, value]) =>
      typeof value === "string" ? [[key, value]] : [],
    ),
  ).toString();
  return `${SITE_URL}/${path}${query ? `?${query}` : ""}`;
}

/** Asks for permission, and finds where to send this phone's push notifications. */
async function pushToken(): Promise<{ granted: boolean; token: string | null }> {
  if (!Device.isDevice) {
    return { granted: false, token: null };
  }
  const existing = await Notifications.getPermissionsAsync();
  const asked = existing.granted ? existing : await Notifications.requestPermissionsAsync();
  if (!asked.granted) {
    return { granted: false, token: null };
  }
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Notifications",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  const { data } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : {});
  return { granted: true, token: data };
}

export function App() {
  // The package's types default to props of `undefined`, which leaves none, so this says `object`.
  const web = useRef<WebView<object>>(null);
  const [start, setStart] = useState<string | null>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const token = useRef<string | null>(null);
  const openedAt = useRef(Date.now());
  const announced = useRef(false);

  const send = useCallback((message: AppMessage) => {
    web.current?.injectJavaScript(deliver(message));
  }, []);

  // Where to open: a link that opened the app, a notification that was tapped, or the site.
  useEffect(() => {
    (async () => {
      const tapped = await Notifications.getLastNotificationResponseAsync();
      const path = tapped?.notification.request.content.data?.path as string | undefined;
      const linked = pageFor(await Linking.getInitialURL());
      setStart(path ? `${SITE_URL}${path}` : (linked ?? SITE_URL));
    })();
  }, []);

  // Links while it's open.
  useEffect(() => {
    const listener = Linking.addEventListener("url", ({ url }) => {
      const page = pageFor(url);
      if (page) {
        web.current?.injectJavaScript(`window.location.assign(${JSON.stringify(page)}); true;`);
      }
    });
    return () => listener.remove();
  }, []);

  // A notification tapped while the app is running opens what it's about.
  useEffect(() => {
    const listener = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as
        | { path?: string; kind?: "notification" | "message" }
        | undefined;
      if (data?.kind) {
        send({ type: "push-opened", kind: data.kind });
      }
      if (data?.path) {
        web.current?.injectJavaScript(
          `window.location.assign(${JSON.stringify(`${SITE_URL}${data.path}`)}); true;`,
        );
      }
    });
    return () => listener.remove();
  }, [send]);

  // Opening and closing the app are recorded, with how long it was open.
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        openedAt.current = Date.now();
        send({ type: "opened", platform: PLATFORM });
      } else if (state === "background") {
        send({
          type: "closed",
          secondsOpen: Math.round((Date.now() - openedAt.current) / 1000),
        });
      }
    });
    return () => listener.remove();
  }, [send]);

  // Android's back button goes back in the site, as in a browser.
  useEffect(() => {
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      if (canGoBack) {
        web.current?.goBack();
        return true;
      }
      return false;
    });
    return () => listener.remove();
  }, [canGoBack]);

  // Each time a page loads, the site hears the push token, since a page that loaded fresh wouldn't
  // know it, and saving it again is harmless. That the app opened is said once, at the first page.
  const onLoadEnd = useCallback(async () => {
    if (!announced.current) {
      announced.current = true;
      send({ type: "opened", platform: PLATFORM });
    }
    if (token.current === null) {
      const { granted, token: found } = await pushToken();
      send({ type: "push-permission", granted });
      token.current = found ?? "";
    }
    if (token.current) {
      send({ type: "push-token", token: token.current, platform: PLATFORM });
    }
  }, [send]);

  if (!start) {
    return null;
  }
  return (
    <SafeAreaView style={styles.page}>
      <StatusBar style="auto" />
      <WebView<object>
        ref={web}
        source={{ uri: start }}
        style={styles.page}
        // The site's sign-in cookie lasts between visits, so coming back is one tap.
        sharedCookiesEnabled
        thirdPartyCookiesEnabled={false}
        injectedJavaScriptBeforeContentLoaded={BEFORE_LOAD}
        onLoadEnd={onLoadEnd}
        onNavigationStateChange={(state: { canGoBack: boolean }) => setCanGoBack(state.canGoBack)}
        allowsBackForwardNavigationGestures
        pullToRefreshEnabled
        // Photos people post come from the site's own file picker.
        allowsInlineMediaPlayback
        setSupportMultipleWindows={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ page: { flex: 1 } });
