/**
 * @name MadpugsFocus
 * @author Madpugs
 * @description Automatically activates Do Not Disturb mode when a game is launched.
 * @version 1.6.5
 * @authorLink https://github.com/Norbit-Online
 * @source https://github.com/Norbit-Online/MadpugsFocus
 * @updateUrl https://raw.githubusercontent.com/Norbit-Online/MadpugsFocus/main/MadpugsFocus.plugin.js
 * @website https://norbit.online
 */

const ACTIVITY_TYPE_PLAYING = 0;
const STATUS_DND = "dnd";
const ACTIVITY_DEBOUNCE_MS = 3000;
const RESTORE_DEBOUNCE_MS = 2000;
const REENABLE_COOLDOWN_MS = 30000;
const TOAST_COOLDOWN_MS = 60000;
const STATUS_POLL_INTERVAL_MS = 10000;
const STATUS_POLL_ACTIVE_MS = 2000;
const DND_TOAST_TIMEOUT_MS = 5000;
const LOG_PREFIX = "[MadpugsFocus]";
const LEGACY_PLUGIN_NAME = "NorbitGameFocus";
const RUNTIME_STATE_KEY = "runtime";

const PLATFORM_LAUNCHERS = {
    steam: {
        label: "Steam",
        exes: ["steam.exe", "steamwebhelper.exe"],
        activityNames: ["Steam"],
    },
    xbox: {
        label: "Xbox",
        exes: ["xboxpcapp.exe", "xboxapp.exe", "gamebar.exe", "gamingservices.exe"],
        activityNames: ["Xbox", "Xbox Game Bar"],
    },
    gog: {
        label: "GOG Galaxy",
        exes: ["galaxyclient.exe"],
        activityNames: ["GOG GALAXY", "GOG Galaxy"],
    },
    epic: {
        label: "Epic Games",
        exes: ["epicgameslauncher.exe"],
        activityNames: ["Epic Games"],
    },
    ea: {
        label: "EA App",
        exes: ["eadesktop.exe", "origin.exe"],
        activityNames: ["EA", "EA Desktop", "Origin"],
    },
    ubisoft: {
        label: "Ubisoft Connect",
        exes: ["ubisoftconnect.exe", "upc.exe"],
        activityNames: ["Ubisoft Connect", "Ubisoft"],
    },
    battlenet: {
        label: "Battle.net",
        exes: ["battle.net.exe"],
        activityNames: ["Battle.net"],
    },
    riot: {
        label: "Riot / League of Legends",
        exes: ["riotclientservices.exe", "riotclientux.exe", "leagueclient.exe"],
        activityNames: ["Riot Client", "League Client"],
        inGameOnly: [{ name: "League of Legends", state: "In Game" }],
    },
};

const DEFAULT_IGNORE_LAUNCHERS = Object.fromEntries(
    Object.keys(PLATFORM_LAUNCHERS).map((key) => [key, true])
);

const MadpugsFocus = (meta) => {
    const { React, Webpack, Data, UI } = BdApi;
    const { useState, useCallback } = React;

    let userSettingsStore = null;
    let userSettingsUtils = null;
    let activityUnsubscribe = null;
    let enableDebounceTimer = null;
    let restoreDebounceTimer = null;
    let statusPollTimer = null;
    let statusBeforeGame = null;
    let dndActive = false;
    let lastRestoreAt = 0;
    let toastLockedUntil = 0;

    const defaultSettings = {
        triggerExes: [],
        ignoredGames: [],
        ignoreLaunchers: { ...DEFAULT_IGNORE_LAUNCHERS },
        showDndToast: true,
    };

    const loadStoredSettings = () => {
        const current = Data.load(meta.name, "settings");
        if (current && Object.keys(current).length > 0) return current;
        return Data.load(LEGACY_PLUGIN_NAME, "settings") ?? {};
    };

    const storedSettings = loadStoredSettings();

    let settings = {
        ...defaultSettings,
        ...storedSettings,
        ignoreLaunchers: {
            ...DEFAULT_IGNORE_LAUNCHERS,
            ...storedSettings?.ignoreLaunchers,
        },
    };

    const panelStyles = {
        container: { padding: "16px", color: "var(--header-primary)" },
        title: {
            fontSize: "16px",
            fontWeight: "600",
            marginBottom: "8px",
            color: "var(--header-primary)",
        },
        description: {
            color: "var(--text-muted)",
            fontSize: "14px",
            marginBottom: "16px",
            lineHeight: "1.4",
        },
        subtitle: {
            fontSize: "12px",
            fontWeight: "600",
            textTransform: "uppercase",
            color: "var(--header-secondary)",
            marginBottom: "8px",
        },
        gameList: { listStyle: "none", padding: 0, margin: "0 0 16px 0" },
        gameItem: {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 12px",
            marginBottom: "4px",
            backgroundColor: "var(--background-secondary)",
            borderRadius: "4px",
        },
        gameName: { color: "var(--text-normal)", fontSize: "14px" },
        removeButton: {
            backgroundColor: "var(--button-danger-background)",
            color: "white",
            border: "none",
            borderRadius: "3px",
            padding: "4px 8px",
            fontSize: "12px",
            cursor: "pointer",
        },
        emptyState: {
            color: "var(--text-muted)",
            fontSize: "14px",
            fontStyle: "italic",
            padding: "12px",
            textAlign: "center",
            backgroundColor: "var(--background-secondary)",
            borderRadius: "4px",
        },
        row: { display: "flex", gap: "8px", marginTop: "12px" },
        input: {
            flex: 1,
            padding: "8px 12px",
            backgroundColor: "var(--input-background)",
            border: "none",
            borderRadius: "4px",
            color: "var(--text-normal)",
            fontSize: "14px",
            outline: "none",
        },
        addButton: {
            backgroundColor: "var(--button-positive-background)",
            color: "white",
            border: "none",
            borderRadius: "3px",
            padding: "8px 16px",
            fontSize: "14px",
            fontWeight: "500",
            cursor: "pointer",
        },
        checkboxRow: {
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginBottom: "16px",
            color: "var(--text-normal)",
            fontSize: "14px",
        },
        checkboxGrid: {
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "8px",
            marginBottom: "16px",
        },
        checkboxGridItem: {
            display: "flex",
            alignItems: "center",
            gap: "8px",
            color: "var(--text-normal)",
            fontSize: "14px",
        },
    };

    const logError = (message, error) => {
        console.error(`${LOG_PREFIX} ${message}`, error ?? "");
    };

    const persistSettings = () => {
        Data.save(meta.name, "settings", settings);
    };

    const loadRuntimeState = () =>
        Data.load(meta.name, RUNTIME_STATE_KEY) ?? {
            managed: false,
            statusBeforeGame: null,
        };

    const saveRuntimeState = (state) => {
        Data.save(meta.name, RUNTIME_STATE_KEY, state);
    };

    const getRestoreTarget = () => {
        const saved = statusBeforeGame ?? loadRuntimeState().statusBeforeGame ?? "online";
        return saved === STATUS_DND ? "online" : saved;
    };

    const normalizeExeName = (value) => {
        const trimmed = String(value ?? "").trim().toLowerCase();
        if (!trimmed) return "";
        return trimmed.endsWith(".exe") ? trimmed : `${trimmed}.exe`;
    };

    const isTriggerExe = (exeName) => {
        const normalized = normalizeExeName(exeName);
        if (!normalized) return false;
        return settings.triggerExes.some(
            (entry) => normalizeExeName(entry) === normalized
        );
    };

    const resolveDiscordModules = () => {
        if (!userSettingsStore) {
            userSettingsStore = Webpack.getModule(
                (module) => module?.getName?.() === "UserSettingsProtoStore",
                { searchExports: true }
            );
        }
        if (!userSettingsUtils) {
            userSettingsUtils = Webpack.getModule(
                (module) =>
                    module?.ProtoClass?.typeName?.endsWith(".PreloadedUserSettings"),
                { searchExports: true }
            );
        }
        return { userSettingsStore, userSettingsUtils };
    };

    const readCurrentStatus = () => {
        try {
            const { userSettingsStore } = resolveDiscordModules();
            return userSettingsStore?.settings?.status?.status?.value ?? "online";
        } catch {
            return "online";
        }
    };

    const writeStatus = (status, force = false) => {
        if (!force && readCurrentStatus() === status) return;

        const applyStatus = () => {
            try {
                const { userSettingsUtils } = resolveDiscordModules();
                userSettingsUtils?.updateAsync?.(
                    "status",
                    (statusSetting) => {
                        if (!statusSetting) return;
                        try {
                            statusSetting.status.value = status;
                        } catch {
                            statusSetting.value = status;
                        }
                    },
                    0
                );
            } catch (error) {
                logError("Failed to update status", error);
            }
        };

        applyStatus();

        if (force) {
            setTimeout(() => {
                if (readCurrentStatus() !== status) applyStatus();
            }, 500);
            setTimeout(() => {
                if (readCurrentStatus() !== status) applyStatus();
            }, 1500);
        }
    };

    const enableDnd = () => {
        if (dndActive) return;

        const currentStatus = readCurrentStatus();
        statusBeforeGame =
            currentStatus === STATUS_DND
                ? getRestoreTarget()
                : currentStatus;

        writeStatus(STATUS_DND);
        dndActive = true;
        saveRuntimeState({ managed: true, statusBeforeGame });
        showDndEnabledToast();
    };

    const showDndEnabledToast = () => {
        if (!settings.showDndToast) return;

        const now = Date.now();
        if (now < toastLockedUntil) return;
        toastLockedUntil = now + TOAST_COOLDOWN_MS;

        try {
            UI.showToast("Do Not Disturb enabled — game detected", {
                type: "info",
                icon: true,
                timeout: DND_TOAST_TIMEOUT_MS,
            });
        } catch (error) {
            logError("Failed to show DND notification", error);
        }
    };

    const scheduleRestore = (activityStore, runningGameStore) => {
        const runtime = loadRuntimeState();
        if (!dndActive && !runtime.managed) return;
        if (restoreDebounceTimer !== null) return;

        restoreDebounceTimer = setTimeout(() => {
            restoreDebounceTimer = null;
            if (!isDiscordPlaying(activityStore, runningGameStore)) {
                restoreStatus();
                lastRestoreAt = Date.now();
            }
        }, RESTORE_DEBOUNCE_MS);
    };

    const restoreStatus = () => {
        const runtime = loadRuntimeState();
        if (!dndActive && !runtime.managed) return;

        const targetStatus = getRestoreTarget();
        statusBeforeGame = null;
        dndActive = false;
        saveRuntimeState({ managed: false, statusBeforeGame: null });
        writeStatus(targetStatus, true);
    };

    const reconcileManagedStatus = (activityStore, runningGameStore) => {
        const runtime = loadRuntimeState();
        if (!runtime.managed) return;

        if (!isDiscordPlaying(activityStore, runningGameStore)) {
            dndActive = true;
            statusBeforeGame = runtime.statusBeforeGame ?? "online";
            restoreStatus();
        }
    };

    const isIgnoredGame = (gameName) => settings.ignoredGames.includes(gameName);

    const isIgnoredLauncher = (exeName, gameName) => {
        for (const [key, platform] of Object.entries(PLATFORM_LAUNCHERS)) {
            if (!settings.ignoreLaunchers[key]) continue;

            if (
                exeName &&
                platform.exes.some(
                    (entry) => normalizeExeName(entry) === normalizeExeName(exeName)
                )
            ) {
                return true;
            }

            if (gameName && platform.activityNames.includes(gameName)) {
                return true;
            }
        }
        return false;
    };

    const shouldSkipUntilInGame = (activity, gameName) => {
        const activityName = gameName ?? activity?.name;
        if (!activityName) return false;

        for (const [key, platform] of Object.entries(PLATFORM_LAUNCHERS)) {
            if (!settings.ignoreLaunchers[key] || !platform.inGameOnly) continue;

            for (const rule of platform.inGameOnly) {
                if (activityName === rule.name && activity?.state !== rule.state) {
                    return true;
                }
            }
        }
        return false;
    };

    const shouldActivateForActivity = (activity) => {
        if (!activity || activity.type !== ACTIVITY_TYPE_PLAYING) return false;
        if (isIgnoredGame(activity.name)) return false;
        if (isIgnoredLauncher(null, activity.name)) return false;
        if (shouldSkipUntilInGame(activity)) return false;
        return true;
    };

    const shouldActivateForRunningGame = (game, activity) => {
        if (!game || game.hidden) return false;
        if (isIgnoredGame(game.name)) return false;
        if (isIgnoredLauncher(game.exeName, game.name)) return false;
        if (settings.triggerExes.length > 0 && !isTriggerExe(game.exeName)) return false;
        if (shouldSkipUntilInGame(activity, game.name)) return false;
        return true;
    };

    const isDiscordPlaying = (activityStore, runningGameStore) => {
        if (settings.triggerExes.length > 0) {
            const runningGames = runningGameStore?.getRunningGames?.() ?? [];
            const activity = activityStore?.getPrimaryActivity?.() ?? null;
            return runningGames.some((game) => shouldActivateForRunningGame(game, activity));
        }

        const activities = activityStore?.getActivities?.();
        if (Array.isArray(activities)) {
            if (activities.length === 0) return false;

            return activities.some((activity) => shouldActivateForActivity(activity));
        }

        const primary = activityStore?.getPrimaryActivity?.() ?? null;
        return shouldActivateForActivity(primary);
    };

    const evaluateGameState = (activityStore, runningGameStore) => {
        try {
            const playing = isDiscordPlaying(activityStore, runningGameStore);

            if (!playing) {
                if (enableDebounceTimer !== null) {
                    clearTimeout(enableDebounceTimer);
                    enableDebounceTimer = null;
                }
                scheduleRestore(activityStore, runningGameStore);
                return;
            }

            if (restoreDebounceTimer !== null) {
                clearTimeout(restoreDebounceTimer);
                restoreDebounceTimer = null;
            }

            if (dndActive) return;

            if (Date.now() - lastRestoreAt < REENABLE_COOLDOWN_MS) {
                return;
            }

            if (enableDebounceTimer !== null) return;

            enableDebounceTimer = setTimeout(() => {
                enableDebounceTimer = null;
                if (
                    isDiscordPlaying(activityStore, runningGameStore) &&
                    !dndActive &&
                    Date.now() - lastRestoreAt >= REENABLE_COOLDOWN_MS
                ) {
                    enableDnd();
                    resetStatusPolling(activityStore, runningGameStore);
                }
            }, ACTIVITY_DEBOUNCE_MS);
        } catch (error) {
            logError("Failed to evaluate game activity", error);
        }
    };

    const resetStatusPolling = (activityStore, runningGameStore) => {
        if (statusPollTimer !== null) {
            clearInterval(statusPollTimer);
        }
        const interval = dndActive ? STATUS_POLL_ACTIVE_MS : STATUS_POLL_INTERVAL_MS;
        statusPollTimer = setInterval(() => {
            evaluateGameState(activityStore, runningGameStore);
        }, interval);
    };

    const watchGameActivity = () => {
        const activityStore = Webpack.getStore("LocalActivityStore");
        const runningGameStore = Webpack.getStore("RunningGameStore");

        if (!activityStore && !runningGameStore) {
            logError("Activity stores not found — Discord may have updated");
            return;
        }

        const runEvaluation = () => {
            evaluateGameState(activityStore, runningGameStore);
            resetStatusPolling(activityStore, runningGameStore);
        };

        const unsubscribers = [];
        if (activityStore?.addChangeListener) {
            unsubscribers.push(activityStore.addChangeListener(runEvaluation));
        }
        if (runningGameStore?.addChangeListener) {
            unsubscribers.push(runningGameStore.addChangeListener(runEvaluation));
        }

        const fluxDispatcher = Webpack.getModule(
            (module) => module?.subscribe && module?.unsubscribe && module?.dispatch,
            { searchExports: true }
        );
        if (fluxDispatcher) {
            const fluxEvents = [
                "LOCAL_ACTIVITY_UPDATE",
                "RUNNING_GAMES_CHANGE",
                "ACTIVITY_SYNC_STOP",
            ];
            fluxEvents.forEach((eventName) => {
                fluxDispatcher.subscribe(eventName, runEvaluation);
                unsubscribers.push(() => fluxDispatcher.unsubscribe(eventName, runEvaluation));
            });
        }

        activityUnsubscribe = () => {
            unsubscribers.forEach((unsubscribe) => unsubscribe?.());
            if (statusPollTimer !== null) {
                clearInterval(statusPollTimer);
                statusPollTimer = null;
            }
        };

        evaluateGameState(activityStore, runningGameStore);
        reconcileManagedStatus(activityStore, runningGameStore);
        resetStatusPolling(activityStore, runningGameStore);
    };

    const SettingsPanel = () => {
        const [triggerExes, setTriggerExes] = useState(settings.triggerExes ?? []);
        const [draftExe, setDraftExe] = useState("");
        const [ignoredGames, setIgnoredGames] = useState(settings.ignoredGames);
        const [draftGame, setDraftGame] = useState("");
        const [ignoreLaunchers, setIgnoreLaunchers] = useState(settings.ignoreLaunchers);
        const [showDndToast, setShowDndToast] = useState(settings.showDndToast ?? true);

        const toggleDndToast = useCallback(() => {
            const next = !showDndToast;
            setShowDndToast(next);
            settings.showDndToast = next;
            persistSettings();
        }, [showDndToast]);

        const toggleLauncherIgnore = useCallback(
            (platformKey) => {
                const next = {
                    ...ignoreLaunchers,
                    [platformKey]: !ignoreLaunchers[platformKey],
                };
                setIgnoreLaunchers(next);
                settings.ignoreLaunchers = next;
                persistSettings();
            },
            [ignoreLaunchers]
        );

        const addTriggerExe = useCallback(() => {
            const exe = normalizeExeName(draftExe);
            if (!exe || triggerExes.some((entry) => normalizeExeName(entry) === exe)) return;

            const next = [...triggerExes, exe];
            setTriggerExes(next);
            settings.triggerExes = next;
            persistSettings();
            setDraftExe("");
        }, [draftExe, triggerExes]);

        const removeTriggerExe = useCallback(
            (exe) => {
                const next = triggerExes.filter(
                    (entry) => normalizeExeName(entry) !== normalizeExeName(exe)
                );
                setTriggerExes(next);
                settings.triggerExes = next;
                persistSettings();
            },
            [triggerExes]
        );

        const addIgnoredGame = useCallback(() => {
            const name = draftGame.trim();
            if (!name || ignoredGames.includes(name)) return;

            const next = [...ignoredGames, name];
            setIgnoredGames(next);
            settings.ignoredGames = next;
            persistSettings();
            setDraftGame("");
        }, [draftGame, ignoredGames]);

        const removeIgnoredGame = useCallback(
            (name) => {
                const next = ignoredGames.filter((game) => game !== name);
                setIgnoredGames(next);
                settings.ignoredGames = next;
                persistSettings();
            },
            [ignoredGames]
        );

        return React.createElement(
            "div",
            { style: panelStyles.container },
            React.createElement("div", { style: panelStyles.title }, "Madpugs Focus"),
            React.createElement(
                "div",
                { style: panelStyles.description },
                "Automatically enables Do Not Disturb while Discord shows you as Playing, then restores your previous status when it clears."
            ),
            React.createElement(
                "label",
                { style: panelStyles.checkboxRow },
                React.createElement("input", {
                    type: "checkbox",
                    checked: showDndToast,
                    onChange: toggleDndToast,
                }),
                "Show on-screen notification when DND is enabled (closes after 5 seconds)"
            ),
            React.createElement("div", { style: panelStyles.subtitle }, "Ignore launchers"),
            React.createElement(
                "div",
                { style: { ...panelStyles.description, marginTop: 0, marginBottom: "8px" } },
                "When ticked, the launcher/client alone will not trigger DND. Riot also waits until League of Legends is \"In Game\" before enabling DND."
            ),
            React.createElement(
                "div",
                { style: panelStyles.checkboxGrid },
                Object.entries(PLATFORM_LAUNCHERS).map(([key, platform]) =>
                    React.createElement(
                        "label",
                        { key, style: panelStyles.checkboxGridItem },
                        React.createElement("input", {
                            type: "checkbox",
                            checked: !!ignoreLaunchers[key],
                            onChange: () => toggleLauncherIgnore(key),
                        }),
                        platform.label
                    )
                )
            ),
            React.createElement("div", { style: panelStyles.subtitle }, "Trigger executables"),
            React.createElement(
                "div",
                { style: { ...panelStyles.description, marginTop: 0, marginBottom: "8px" } },
                "Only these .exe files trigger DND. Leave empty to trigger on any detected game. Check Task Manager or Discord's detected game details for exact names."
            ),
            triggerExes.length === 0
                ? React.createElement(
                      "div",
                      { style: panelStyles.emptyState },
                      "No executables configured. Any detected game will trigger DND."
                  )
                : React.createElement(
                      "ul",
                      { style: panelStyles.gameList },
                      triggerExes.map((exe) =>
                          React.createElement(
                              "li",
                              { key: exe, style: panelStyles.gameItem },
                              React.createElement("span", { style: panelStyles.gameName }, exe),
                              React.createElement(
                                  "button",
                                  {
                                      type: "button",
                                      style: panelStyles.removeButton,
                                      onClick: () => removeTriggerExe(exe),
                                  },
                                  "Remove"
                              )
                          )
                      )
                  ),
            React.createElement(
                "div",
                { style: panelStyles.row },
                React.createElement("input", {
                    type: "text",
                    value: draftExe,
                    onChange: (event) => setDraftExe(event.target.value),
                    onKeyDown: (event) => {
                        if (event.key === "Enter") addTriggerExe();
                    },
                    placeholder: "e.g. eldenring.exe",
                    style: panelStyles.input,
                }),
                React.createElement(
                    "button",
                    { type: "button", style: panelStyles.addButton, onClick: addTriggerExe },
                    "Add"
                )
            ),
            React.createElement("div", { style: panelStyles.subtitle }, "Ignored games"),
            ignoredGames.length === 0
                ? React.createElement(
                      "div",
                      { style: panelStyles.emptyState },
                      "No ignored games. Add titles that should not trigger DND."
                  )
                : React.createElement(
                      "ul",
                      { style: panelStyles.gameList },
                      ignoredGames.map((game) =>
                          React.createElement(
                              "li",
                              { key: game, style: panelStyles.gameItem },
                              React.createElement("span", { style: panelStyles.gameName }, game),
                              React.createElement(
                                  "button",
                                  {
                                      type: "button",
                                      style: panelStyles.removeButton,
                                      onClick: () => removeIgnoredGame(game),
                                  },
                                  "Remove"
                              )
                          )
                      )
                  ),
            React.createElement(
                "div",
                { style: panelStyles.row },
                React.createElement("input", {
                    type: "text",
                    value: draftGame,
                    onChange: (event) => setDraftGame(event.target.value),
                    onKeyDown: (event) => {
                        if (event.key === "Enter") addIgnoredGame();
                    },
                    placeholder: "Exact game name as shown in Discord...",
                    style: panelStyles.input,
                }),
                React.createElement(
                    "button",
                    { type: "button", style: panelStyles.addButton, onClick: addIgnoredGame },
                    "Add"
                )
            )
        );
    };

    return {
        start() {
            try {
                resolveDiscordModules();
                watchGameActivity();
            } catch (error) {
                logError("Failed to start", error);
            }
        },

        stop() {
            try {
                if (enableDebounceTimer !== null) {
                    clearTimeout(enableDebounceTimer);
                    enableDebounceTimer = null;
                }
                if (restoreDebounceTimer !== null) {
                    clearTimeout(restoreDebounceTimer);
                    restoreDebounceTimer = null;
                }
                if (statusPollTimer !== null) {
                    clearInterval(statusPollTimer);
                    statusPollTimer = null;
                }
                if (activityUnsubscribe) {
                    activityUnsubscribe();
                    activityUnsubscribe = null;
                }

                const activityStore = Webpack.getStore("LocalActivityStore");
                const runningGameStore = Webpack.getStore("RunningGameStore");
                const runtime = loadRuntimeState();

                if (runtime.managed || dndActive) {
                    restoreStatus();
                } else if (
                    readCurrentStatus() === STATUS_DND &&
                    !isDiscordPlaying(activityStore, runningGameStore)
                ) {
                    writeStatus("online", true);
                    saveRuntimeState({ managed: false, statusBeforeGame: null });
                }

                persistSettings();
            } catch (error) {
                logError("Failed to stop", error);
            }
        },

        getSettingsPanel() {
            return React.createElement(SettingsPanel);
        },
    };
};

module.exports = MadpugsFocus;
