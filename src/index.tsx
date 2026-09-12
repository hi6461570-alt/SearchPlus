import { after, before, instead } from "@vendetta/patcher";
import { find, findByName, findByProps, findByStoreName } from "@vendetta/metro";
import { ReactNative } from "@vendetta/metro/common";
import { React } from "@vendetta/metro/common";
import { plugin } from "@vendetta/plugin";

const { ScrollView, View, Text, TextInput, TouchableOpacity } = ReactNative;

type Scope = "everywhere" | "guild" | "dm" | "channel";
type SortBy = "timestamp" | "relevance";
type SortOrder = "asc" | "desc";

type Location = {
    id: string;
    name: string;
    type: "guild" | "dm" | "channel";
    parentId?: string;
    guildId?: string;
};

type SearchFilters = {
    author: string;
    mention: string;
    linkHostname: string;
    attachmentExtension: string;
    attachmentFilename: string;
    before: string;
    after: string;
    authorType: string;
    has: string[];
};

const defaults = {
    enabled: true,
    defaultScope: "everywhere" as Scope,
    defaultSort: "timestamp" as SortBy,
    defaultOrder: "desc" as SortOrder,
    rememberHistory: true,
    historyLimit: 20,
    parallelism: 4,
    pageSize: 25,
};

function storageGet<T>(key: string, fallback: T): T {
    try {
        const value = plugin.storage[key];
        return value === undefined ? fallback : value as T;
    } catch {
        return fallback;
    }
}

function storageSet(key: string, value: unknown) {
    plugin.storage[key] = value;
}

function discoverApi() {
    return (
        findByProps("get", "post") ??
        findByProps("get", "request") ??
        findByProps("request") ??
        findByProps("getAPIBaseURL", "get")
    );
}

function discoverAuth() {
    return findByProps("getToken", "getSessionId");
}

async function request(path: string, params: Record<string, string | number | boolean> = {}) {
    const api = discoverApi();

    if (api?.get) {
        try {
            return await api.get(path, params);
        } catch {}
    }

    if (api?.request) {
        try {
            return await api.request({
                method: "GET",
                url: path,
                query: params,
            });
        } catch {}
    }

    const auth = discoverAuth();
    const token = auth?.getToken?.();

    if (!token) throw new Error("Discord request module unavailable.");

    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
    }

    const url = `https://discord.com/api/v10${path}${query.toString() ? `?${query}` : ""}`;
    const response = await fetch(url, {
        headers: {
            Authorization: token,
            Accept: "application/json",
        },
    });

    if (!response.ok) throw new Error(`Discord API ${response.status}`);
    return response.json();
}

async function fetchGuilds(): Promise<Location[]> {
    const data = await request("/users/@me/guilds");
    return (data ?? []).map((guild: any) => ({
        id: guild.id,
        name: guild.name ?? "Unknown Server",
        type: "guild",
    }));
}

async function fetchDMs(): Promise<Location[]> {
    const data = await request("/users/@me/channels");
    return (data ?? []).map((channel: any) => ({
        id: channel.id,
        name: channel.name || channel.recipients?.map((x: any) => x.username).join(", ") || "Direct Message",
        type: "dm",
    }));
}

async function fetchGuildChannels(guildId: string): Promise<Location[]> {
    const data = await request(`/guilds/${guildId}/channels`);
    return (data ?? [])
        .filter((channel: any) => [0, 5, 10, 11, 12].includes(channel.type))
        .map((channel: any) => ({
            id: channel.id,
            name: channel.name ?? "Unnamed Channel",
            type: "channel",
            parentId: channel.parent_id ?? undefined,
            guildId,
        }));
}

async function loadLocations(): Promise<Location[]> {
    const [guilds, dms] = await Promise.all([fetchGuilds(), fetchDMs()]);
    const channels: Location[] = [];

    for (let i = 0; i < guilds.length; i += Math.max(1, storageGet("parallelism", defaults.parallelism))) {
        const batch = guilds.slice(i, i + Math.max(1, storageGet("parallelism", defaults.parallelism)));
        const result = await Promise.all(batch.map(x => fetchGuildChannels(x.id)));
        channels.push(...result.flat());
    }

    return [...guilds, ...dms, ...channels];
}

function buildQuery(query: string, filters: SearchFilters, sortBy: SortBy, sortOrder: SortOrder, limit: number) {
    const params: Record<string, string | number> = {
        content: query,
        sort_by: sortBy,
        sort_order: sortOrder,
        limit,
    };

    const entries: [keyof SearchFilters, string][] = [
        ["author", "author_id"],
        ["mention", "mentions"],
        ["linkHostname", "link_hostname"],
        ["attachmentExtension", "attachment_extension"],
        ["attachmentFilename", "attachment_filename"],
        ["before", "before"],
        ["after", "after"],
        ["authorType", "author_type"],
    ];

    for (const [key, apiKey] of entries) {
        if (filters[key]) params[apiKey] = filters[key] as string;
    }

    if (filters.has.length) params.has = filters.has.join(",");

    return params;
}

async function searchLocation(
    location: Location,
    query: string,
    filters: SearchFilters,
    sortBy: SortBy,
    sortOrder: SortOrder,
    limit: number,
) {
    const path = location.type === "guild"
        ? `/guilds/${location.id}/messages/search`
        : `/channels/${location.id}/messages/search`;

    return request(path, buildQuery(query, filters, sortBy, sortOrder, limit));
}

function normalizeResponse(data: any): any[] {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.messages)) return data.messages.flat();
    if (Array.isArray(data?.results)) return data.results;
    return [];
}

async function runPool<T>(items: T[], worker: (item: T) => Promise<any>, concurrency: number) {
    const output: any[] = [];
    let index = 0;

    async function runner() {
        while (index < items.length) {
            const item = items[index++];
            try {
                output.push(await worker(item));
            } catch {}
        }
    }

    await Promise.all(
        Array.from(
            { length: Math.min(Math.max(1, concurrency), items.length || 1) },
            runner,
        ),
    );

    return output.flat();
}

function jumpToResult(channelId: string, messageId: string) {
    const url = `https://discord.com/channels/@me/${channelId}/${messageId}`;
    const navigation = findByProps("openExternalUrl", "openURL");

    if (navigation?.openExternalUrl) {
        navigation.openExternalUrl(url);
        return;
    }

    if (navigation?.openURL) {
        navigation.openURL(url);
        return;
    }

    ReactNative.Linking?.openURL?.(url);
}

function Button({ title, onPress }: { title: string; onPress: () => void }) {
    return (
        <TouchableOpacity
            onPress={onPress}
            style={{
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderRadius: 10,
                backgroundColor: "#5865F2",
                marginRight: 8,
                marginBottom: 8,
            }}
        >
            <Text style={{ color: "white", fontWeight: "700" }}>{title}</Text>
        </TouchableOpacity>
    );
}

function SearchScreen({ onClose }: { onClose: () => void }) {
    const [query, setQuery] = React.useState("");
    const [scope, setScope] = React.useState<Scope>(storageGet("defaultScope", defaults.defaultScope));
    const [sortBy, setSortBy] = React.useState<SortBy>(storageGet("defaultSort", defaults.defaultSort));
    const [sortOrder, setSortOrder] = React.useState<SortOrder>(storageGet("defaultOrder", defaults.defaultOrder));
    const [locations, setLocations] = React.useState<Location[]>([]);
    const [selected, setSelected] = React.useState<Location | null>(null);
    const [locationSearch, setLocationSearch] = React.useState("");
    const [results, setResults] = React.useState<any[]>([]);
    const [error, setError] = React.useState("");
    const [loading, setLoading] = React.useState(false);

    const [filters, setFilters] = React.useState<SearchFilters>({
        author: "",
        mention: "",
        linkHostname: "",
        attachmentExtension: "",
        attachmentFilename: "",
        before: "",
        after: "",
        authorType: "",
        has: [],
    });

    React.useEffect(() => {
        loadLocations()
            .then(setLocations)
            .catch(error => setError(String(error)));
    }, []);

    const visibleLocations = locations.filter(x =>
        x.name.toLowerCase().includes(locationSearch.toLowerCase()),
    );

    const candidates = React.useMemo(() => {
        if (scope === "guild") return locations.filter(x => x.type === "guild");
        if (scope === "dm") return locations.filter(x => x.type === "dm");
        if (scope === "channel") return locations.filter(x => x.type === "channel");
        return locations.filter(x => x.type === "guild" || x.type === "dm");
    }, [locations, scope]);

    async function search() {
        if (!query.trim() && !Object.values(filters).some(x => Array.isArray(x) ? x.length : x)) {
            setError("Enter a search term or at least one filter.");
            return;
        }

        setLoading(true);
        setError("");

        try {
            const targets = selected
                ? [selected]
                : candidates;

            const found = await runPool(
                targets,
                location => searchLocation(
                    location,
                    query.trim(),
                    filters,
                    sortBy,
                    sortOrder,
                    storageGet("pageSize", defaults.pageSize),
                ).then(normalizeResponse),
                storageGet("parallelism", defaults.parallelism),
            );

            setResults(found);

            if (storageGet("rememberHistory", defaults.rememberHistory)) {
                const history = storageGet<string[]>("history", []);
                const next = [query, ...history.filter(x => x !== query)].slice(
                    0,
                    storageGet("historyLimit", defaults.historyLimit),
                );
                storageSet("history", next);
            }
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    }

    return (
        <View style={{ flex: 1, backgroundColor: "#111214" }}>
            <ScrollView contentContainerStyle={{ padding: 16 }}>
                <Text style={{ color: "white", fontSize: 26, fontWeight: "800", marginBottom: 14 }}>
                    Search+
                </Text>

                <TextInput
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Search messages..."
                    placeholderTextColor="#777"
                    style={{
                        backgroundColor: "#1E1F22",
                        color: "white",
                        borderRadius: 12,
                        padding: 13,
                        marginBottom: 12,
                    }}
                />

                <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                    {(["everywhere", "guild", "dm", "channel"] as Scope[]).map(x => (
                        <Button title={x} onPress={() => {
                            setScope(x);
                            setSelected(null);
                        }} />
                    ))}
                </View>

                <Text style={{ color: "#B5BAC1", marginTop: 8, marginBottom: 6 }}>
                    Location
                </Text>

                <TextInput
                    value={locationSearch}
                    onChangeText={setLocationSearch}
                    placeholder="Filter locations..."
                    placeholderTextColor="#777"
                    style={{
                        backgroundColor: "#1E1F22",
                        color: "white",
                        borderRadius: 10,
                        padding: 11,
                        marginBottom: 8,
                    }}
                />

                <View style={{ maxHeight: 180 }}>
                    <ScrollView horizontal>
                        <View style={{ flexDirection: "row" }}>
                            {visibleLocations
                                .filter(x => candidates.includes(x))
                                .slice(0, 100)
                                .map(x => (
                                    <Button
                                        title={selected?.id === x.id ? `✓ ${x.name}` : x.name}
                                        onPress={() => setSelected(selected?.id === x.id ? null : x)}
                                    />
                                ))}
                        </View>
                    </ScrollView>
                </View>

                <Text style={{ color: "#B5BAC1", marginTop: 10 }}>
                    Filters
                </Text>

                {[
                    ["author", "Author ID"],
                    ["mention", "Mention ID"],
                    ["linkHostname", "Link hostname"],
                    ["attachmentExtension", "Attachment extension"],
                    ["attachmentFilename", "Attachment filename"],
                    ["before", "Before (date/message ID)"],
                    ["after", "After (date/message ID)"],
                    ["authorType", "Author type"],
                ].map(([key, placeholder]) => (
                    <TextInput
                        key={key}
                        value={(filters as any)[key]}
                        onChangeText={value => setFilters({ ...filters, [key]: value })}
                        placeholder={placeholder}
                        placeholderTextColor="#777"
                        style={{
                            backgroundColor: "#1E1F22",
                            color: "white",
                            borderRadius: 10,
                            padding: 11,
                            marginTop: 8,
                        }}
                    />
                ))}

                <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 12 }}>
                    <Button title={`Sort: ${sortBy}`} onPress={() => setSortBy(sortBy === "timestamp" ? "relevance" : "timestamp")} />
                    <Button title={`Order: ${sortOrder}`} onPress={() => setSortOrder(sortOrder === "desc" ? "asc" : "desc")} />
                    <Button title={loading ? "Searching..." : "Search"} onPress={search} />
                    <Button title="Close" onPress={onClose} />
                </View>

                {!!error && (
                    <Text style={{ color: "#ED4245", marginVertical: 10 }}>
                        {error}
                    </Text>
                )}

                {results.map((result, index) => {
                    const message = result?.message ?? result;
                    const channelId = message?.channel_id;
                    const messageId = message?.id;

                    return (
                        <TouchableOpacity
                            key={`${channelId}-${messageId}-${index}`}
                            onPress={() => channelId && messageId && jumpToResult(channelId, messageId)}
                            style={{
                                backgroundColor: "#1E1F22",
                                borderRadius: 12,
                                padding: 12,
                                marginTop: 8,
                            }}
                        >
                            <Text style={{ color: "#B5BAC1", fontSize: 12 }}>
                                {message?.author?.username ?? "Unknown"} · {message?.timestamp ?? ""}
                            </Text>
                            <Text style={{ color: "white", marginTop: 5 }}>
                                {message?.content || "(no text)"}
                            </Text>
                        </TouchableOpacity>
                    );
                })}
            </ScrollView>
        </View>
    );
}

function openSearchScreen() {
    const navigation = findByProps("push", "pop", "replace");

    if (navigation?.push) {
        navigation.push(SearchScreen, {});
        return;
    }

    const modal = findByProps("open", "close");

    if (modal?.open) {
        modal.open(SearchScreen);
        return;
    }

    throw new Error("Could not find a compatible Shiggy navigation module.");
}

function Settings() {
    return (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
            <Text style={{ color: "white", fontSize: 26, fontWeight: "800", marginBottom: 8 }}>
                Search+
            </Text>

            <Text style={{ color: "#B5BAC1", marginBottom: 16 }}>
                Advanced message search for ShiggyCord.
            </Text>

            <Button title="Open Search+" onPress={openSearchScreen} />

            <Text style={{ color: "#B5BAC1", marginTop: 20 }}>
                Defaults
            </Text>

            <Button
                title={`Default scope: ${storageGet("defaultScope", defaults.defaultScope)}`}
                onPress={() => storageSet(
                    "defaultScope",
                    storageGet("defaultScope", defaults.defaultScope) === "everywhere" ? "guild" : "everywhere",
                )}
            />

            <Button
                title={`Sort: ${storageGet("defaultSort", defaults.defaultSort)}`}
                onPress={() => storageSet(
                    "defaultSort",
                    storageGet("defaultSort", defaults.defaultSort) === "timestamp" ? "relevance" : "timestamp",
                )}
            />

            <Button
                title={`Order: ${storageGet("defaultOrder", defaults.defaultOrder)}`}
                onPress={() => storageSet(
                    "defaultOrder",
                    storageGet("defaultOrder", defaults.defaultOrder) === "desc" ? "asc" : "desc",
                )}
            />

            <Button
                title={`Remember history: ${storageGet("rememberHistory", defaults.rememberHistory) ? "ON" : "OFF"}`}
                onPress={() => storageSet(
                    "rememberHistory",
                    !storageGet("rememberHistory", defaults.rememberHistory),
                )}
            />

            <Button
                title={`Parallel searches: ${storageGet("parallelism", defaults.parallelism)}`}
                onPress={() => {
                    const value = storageGet("parallelism", defaults.parallelism);
                    storageSet("parallelism", value >= 8 ? 1 : value + 1);
                }}
            />
        </ScrollView>
    );
}

export default {
    onLoad() {},
    onUnload() {},
    settings: Settings,
};
