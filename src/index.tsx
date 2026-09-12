import { plugin } from "@vendetta";
import { find, findByProps, findByName, findByStoreName } from "@vendetta/metro";
import { React, ReactNative } from "@vendetta/metro/common";

type Scope = "everywhere" | "guild" | "dm" | "channel";
type Sort = "timestamp" | "relevance";
type Order = "asc" | "desc";

type Location = {
    id: string;
    type: "guild" | "dm" | "channel";
    name: string;
    subtitle?: string;
    icon?: string;
    guildId?: string;
};

type SearchFilters = {
    content: string;
    authorId: string;
    mentions: string;
    has: string[];
    linkHostname: string;
    attachmentExtension: string;
    attachmentFilename: string;
    before: string;
    after: string;
    authorType: "" | "user" | "bot" | "webhook";
};

type SearchResult = {
    id: string;
    channelId: string;
    guildId?: string | null;
    content: string;
    timestamp: string;
    author?: {
        id: string;
        username?: string;
        global_name?: string;
        avatar?: string;
    };
    attachments?: any[];
    embeds?: any[];
};

const RN = ReactNative;
const { View, Text, ScrollView, Pressable, TextInput, ActivityIndicator } = RN;

const DEFAULT_FILTERS: SearchFilters = {
    content: "",
    authorId: "",
    mentions: "",
    has: [],
    linkHostname: "",
    attachmentExtension: "",
    attachmentFilename: "",
    before: "",
    after: "",
    authorType: "",
};

const DEFAULTS = {
    enabled: true,
    defaultScope: "everywhere" as Scope,
    defaultSort: "timestamp" as Sort,
    defaultOrder: "desc" as Order,
    rememberHistory: true,
    historyLimit: 50,
    parallelism: 5,
    pageSize: 25,
};

const stores = {
    guild: findByStoreName("GuildStore"),
    channel: findByStoreName("ChannelStore"),
    user: findByStoreName("UserStore"),
    relationship: findByStoreName("RelationshipStore"),
};

const apiCandidates = [
    findByProps("get", "post"),
    findByProps("get", "request"),
    findByProps("request"),
    findByProps("getAPIBaseURL", "get"),
].filter(Boolean);

function getSetting<T>(key: string, fallback: T): T {
    return plugin.storage[key] ?? fallback;
}

function setSetting(key: string, value: unknown) {
    plugin.storage[key] = value;
}

function initialize() {
    for (const [key, value] of Object.entries(DEFAULTS)) {
        if (plugin.storage[key] === undefined) setSetting(key, value);
    }

    if (!Array.isArray(plugin.storage.history)) setSetting("history", []);
    if (!Array.isArray(plugin.storage.saved)) setSetting("saved", []);
}

function getApiModule(): any {
    return apiCandidates.find(Boolean);
}

function buildQuery(filters: SearchFilters, sort: Sort, order: Order) {
    const params = new URLSearchParams();

    if (filters.content.trim()) params.set("content", filters.content.trim());
    if (filters.authorId.trim()) params.set("author_id", filters.authorId.trim());
    if (filters.mentions.trim()) params.set("mentions", filters.mentions.trim());
    if (filters.linkHostname.trim()) params.set("link_hostname", filters.linkHostname.trim());
    if (filters.attachmentExtension.trim()) params.set("attachment_extension", filters.attachmentExtension.trim());
    if (filters.attachmentFilename.trim()) params.set("attachment_filename", filters.attachmentFilename.trim());

    if (filters.before.trim()) params.set("before", filters.before.trim());
    if (filters.after.trim()) params.set("after", filters.after.trim());

    if (filters.authorType) params.set("author_type", filters.authorType);

    for (const item of filters.has) params.append("has", item);

    params.set("sort_by", sort === "relevance" ? "relevance" : "timestamp");
    params.set("sort_order", order);
    params.set("limit", String(getSetting("pageSize", 25)));

    return params;
}

async function internalRequest(method: "GET" | "POST", path: string, params?: Record<string, unknown>) {
    const api = getApiModule();

    if (api) {
        if (typeof api.get === "function") {
            try {
                return await api.get(path, params);
            } catch {}

            try {
                return await api.get(path.startsWith("/") ? path.slice(1) : path, params);
            } catch {}
        }

        if (typeof api.request === "function") {
            return await api.request({
                method,
                url: path,
                query: params,
                body: params,
            });
        }
    }

    const auth = findByProps("getToken", "getSessionId");
    const superProperties = findByProps("getSuperPropertiesBase64");

    const token = auth?.getToken?.();
    if (!token) {
        throw new Error("Shiggy's authenticated request module was not found.");
    }

    const query = new URLSearchParams();

    if (params) {
        for (const [key, value] of Object.entries(params)) {
            if (Array.isArray(value)) {
                for (const item of value) query.append(key, String(item));
            } else if (value !== undefined && value !== null) {
                query.set(key, String(value));
            }
        }
    }

    const url = `https://discord.com/api/v10${path}${query.size ? `?${query}` : ""}`;

    const headers: Record<string, string> = {
        Authorization: token,
        Accept: "application/json",
        "Content-Type": "application/json",
    };

    const encoded = superProperties?.getSuperPropertiesBase64?.();
    if (encoded) headers["X-Super-Properties"] = encoded;

    const response = await fetch(url, {
        method,
        headers,
    });

    if (!response.ok) {
        throw new Error(`Discord returned HTTP ${response.status}`);
    }

    return response.json();
}

async function fetchGuilds(): Promise<Location[]> {
    const result = await internalRequest("GET", "/users/@me/guilds");
    const guilds = Array.isArray(result) ? result : result?.guilds ?? [];

    return guilds.map((guild: any) => ({
        id: guild.id,
        type: "guild" as const,
        name: guild.name ?? "Unnamed server",
        subtitle: `${guild.id}`,
        icon: guild.icon,
    }));
}

async function fetchDMs(): Promise<Location[]> {
    const result = await internalRequest("GET", "/users/@me/channels");
    const channels = Array.isArray(result) ? result : result?.channels ?? [];

    return channels
        .filter((channel: any) => channel?.id)
        .map((channel: any) => {
            const recipients = channel.recipients ?? [];
            const name =
                channel.name ||
                recipients
                    .map((user: any) => user.global_name || user.username)
                    .filter(Boolean)
                    .join(", ") ||
                "Direct Message";

            return {
                id: channel.id,
                type: "dm" as const,
                name,
                subtitle: channel.type === 3 ? "Group DM" : "Direct Message",
            };
        });
}

async function fetchGuildChannels(guildId: string): Promise<Location[]> {
    const result = await internalRequest("GET", `/guilds/${guildId}/channels`);
    const channels = Array.isArray(result) ? result : result?.channels ?? [];

    return channels
        .filter((channel: any) => [0, 5, 10, 11, 12].includes(channel?.type))
        .map((channel: any) => ({
            id: channel.id,
            type: "channel" as const,
            name: `#${channel.name ?? channel.id}`,
            subtitle: guildId,
            guildId,
        }));
}

async function loadLocations(): Promise<Location[]> {
    const [guilds, dms] = await Promise.all([
        fetchGuilds().catch(() => []),
        fetchDMs().catch(() => []),
    ]);

    const channels: Location[] = [];

    for (const guild of guilds) {
        try {
            channels.push(...await fetchGuildChannels(guild.id));
        } catch {}
    }

    return [...guilds, ...dms, ...channels];
}

function normalizeResponse(data: any): SearchResult[] {
    const messages = data?.messages ?? data?.results ?? data ?? [];
    const flattened = Array.isArray(messages)
        ? messages.flatMap((item: any) => Array.isArray(item) ? item : [item])
        : [];

    return flattened
        .filter((message: any) => message?.id && message?.channel_id)
        .map((message: any) => ({
            id: message.id,
            channelId: message.channel_id,
            guildId: message.guild_id ?? null,
            content: message.content ?? "",
            timestamp: message.timestamp ?? new Date().toISOString(),
            author: message.author,
            attachments: message.attachments ?? [],
            embeds: message.embeds ?? [],
        }));
}

async function searchLocation(location: Location, filters: SearchFilters, sort: Sort, order: Order): Promise<SearchResult[]> {
    const params = Object.fromEntries(buildQuery(filters, sort, order).entries());

    const path =
        location.type === "guild"
            ? `/guilds/${location.id}/messages/search`
            : `/channels/${location.id}/messages/search`;

    const data = await internalRequest("GET", path, params);
    return normalizeResponse(data);
}

async function runPool<T, R>(
    values: T[],
    worker: (value: T) => Promise<R>,
    concurrency: number,
): Promise<R[]> {
    const results: R[] = [];
    let cursor = 0;

    async function runner() {
        while (true) {
            const index = cursor++;
            if (index >= values.length) return;

            try {
                results[index] = await worker(values[index]);
            } catch {
                results[index] = undefined as R;
            }
        }
    }

    await Promise.all(
        Array.from(
            { length: Math.max(1, Math.min(concurrency, values.length || 1)) },
            runner,
        ),
    );

    return results;
}

function addHistory(query: string, scope: Scope, location?: Location) {
    if (!getSetting("rememberHistory", true) || !query.trim()) return;

    const history = Array.isArray(plugin.storage.history)
        ? plugin.storage.history
        : [];

    const entry = {
        query: query.trim(),
        scope,
        locationId: location?.id,
        locationName: location?.name,
        time: Date.now(),
    };

    const next = [
        entry,
        ...history.filter(
            (item: any) =>
                item.query !== entry.query ||
                item.scope !== entry.scope ||
                item.locationId !== entry.locationId,
        ),
    ].slice(0, getSetting("historyLimit", 50));

    setSetting("history", next);
}

function jumpToResult(result: SearchResult) {
    const guild = result.guildId ?? "@me";
    const url =
        guild === "@me"
            ? `https://discord.com/channels/@me/${result.channelId}/${result.id}`
            : `https://discord.com/channels/${guild}/${result.channelId}/${result.id}`;

    const opener = findByProps("openExternalUrl", "openURL");
    if (opener?.openExternalUrl) {
        opener.openExternalUrl(url);
        return;
    }

    if (opener?.openURL) {
        opener.openURL(url);
        return;
    }

    RN.Linking?.openURL?.(url);
}

function Label({ children }: { children: React.ReactNode }) {
    return <Text style={{ color: "#f2f3f5", fontSize: 15, fontWeight: "600", marginBottom: 7 }}>{children}</Text>;
}

function Input(props: any) {
    return (
        <TextInput
            {...props}
            placeholderTextColor="#72767d"
            style={{
                backgroundColor: "#1e1f22",
                borderRadius: 10,
                color: "#f2f3f5",
                paddingHorizontal: 13,
                paddingVertical: 11,
                marginBottom: 12,
                ...props.style,
            }}
        />
    );
}

function Button({ title, onPress, disabled = false }: { title: string; onPress: () => void; disabled?: boolean }) {
    return (
        <Pressable
            disabled={disabled}
            onPress={onPress}
            style={{
                backgroundColor: disabled ? "#313338" : "#5865f2",
                paddingHorizontal: 16,
                paddingVertical: 12,
                borderRadius: 10,
                marginBottom: 10,
            }}
        >
            <Text style={{ color: "#fff", textAlign: "center", fontWeight: "700" }}>{title}</Text>
        </Pressable>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <View style={{ marginBottom: 18 }}>
            <Text style={{ color: "#949ba4", fontSize: 12, fontWeight: "800", marginBottom: 8, textTransform: "uppercase" }}>
                {title}
            </Text>
            <View style={{ backgroundColor: "#2b2d31", borderRadius: 12, padding: 12 }}>
                {children}
            </View>
        </View>
    );
}

function Settings() {
    const [, refresh] = React.useReducer((value: number) => value + 1, 0);

    const update = (key: string, value: unknown) => {
        setSetting(key, value);
        refresh();
    };

    return (
        <ScrollView style={{ flex: 1, backgroundColor: "#111214" }} contentContainerStyle={{ padding: 16 }}>
            <Text style={{ color: "#f2f3f5", fontSize: 24, fontWeight: "800", marginBottom: 4 }}>
                Search+
            </Text>
            <Text style={{ color: "#949ba4", marginBottom: 20 }}>
                Deep message search across servers, DMs and channels.
            </Text>

            <Section title="General">
                <Text style={{ color: "#f2f3f5", fontSize: 15, marginBottom: 12 }}>
                    Open Search+ from this plugin's settings page to search Discord.
                </Text>
                <Button title="Open Search+" onPress={() => openSearchScreen()} />
            </Section>

            <Section title="Defaults">
                <Label>Default scope</Label>
                <Input
                    value={getSetting("defaultScope", "everywhere")}
                    onChangeText={(value: string) => update("defaultScope", value)}
                    placeholder="everywhere / guild / dm / channel"
                />

                <Label>Default sort</Label>
                <Input
                    value={getSetting("defaultSort", "timestamp")}
                    onChangeText={(value: string) => update("defaultSort", value)}
                    placeholder="timestamp / relevance"
                />

                <Label>Default order</Label>
                <Input
                    value={getSetting("defaultOrder", "desc")}
                    onChangeText={(value: string) => update("defaultOrder", value)}
                    placeholder="desc / asc"
                />
            </Section>

            <Section title="Performance">
                <Label>Parallel searches</Label>
                <Input
                    keyboardType="numeric"
                    value={String(getSetting("parallelism", 5))}
                    onChangeText={(value: string) =>
                        update("parallelism", Math.max(1, Math.min(15, Number(value) || 5)))
                    }
                />

                <Label>Results per location</Label>
                <Input
                    keyboardType="numeric"
                    value={String(getSetting("pageSize", 25))}
                    onChangeText={(value: string) =>
                        update("pageSize", Math.max(10, Math.min(100, Number(value) || 25)))
                    }
                />
            </Section>

            <Section title="History">
                <Label>History limit</Label>
                <Input
                    keyboardType="numeric"
                    value={String(getSetting("historyLimit", 50))}
                    onChangeText={(value: string) =>
                        update("historyLimit", Math.max(0, Math.min(500, Number(value) || 50)))
                    }
                />

                <Button
                    title="Clear Search History"
                    onPress={() => {
                        setSetting("history", []);
                        refresh();
                    }}
                />
            </Section>
        </ScrollView>
    );
}

function LocationRow({
    location,
    selected,
    onPress,
}: {
    location: Location;
    selected: boolean;
    onPress: () => void;
}) {
    return (
        <Pressable
            onPress={onPress}
            style={{
                padding: 13,
                borderRadius: 10,
                backgroundColor: selected ? "#404675" : "#2b2d31",
                marginBottom: 7,
            }}
        >
            <Text style={{ color: "#f2f3f5", fontWeight: "700" }}>{location.name}</Text>
            {!!location.subtitle && (
                <Text style={{ color: "#949ba4", fontSize: 12, marginTop: 3 }}>{location.subtitle}</Text>
            )}
        </Pressable>
    );
}

function SearchScreen() {
    const [query, setQuery] = React.useState("");
    const [scope, setScope] = React.useState<Scope>(getSetting("defaultScope", "everywhere"));
    const [sort, setSort] = React.useState<Sort>(getSetting("defaultSort", "timestamp"));
    const [order, setOrder] = React.useState<Order>(getSetting("defaultOrder", "desc"));
    const [filters, setFilters] = React.useState<SearchFilters>({ ...DEFAULT_FILTERS });
    const [locations, setLocations] = React.useState<Location[]>([]);
    const [locationSearch, setLocationSearch] = React.useState("");
    const [selected, setSelected] = React.useState<Location | undefined>();
    const [results, setResults] = React.useState<SearchResult[]>([]);
    const [loadingLocations, setLoadingLocations] = React.useState(true);
    const [loadingSearch, setLoadingSearch] = React.useState(false);
    const [error, setError] = React.useState("");

    React.useEffect(() => {
        let alive = true;

        setLoadingLocations(true);
        loadLocations()
            .then(value => {
                if (alive) setLocations(value);
            })
            .catch(error => {
                if (alive) setError(String(error?.message ?? error));
            })
            .finally(() => {
                if (alive) setLoadingLocations(false);
            });

        return () => {
            alive = false;
        };
    }, []);

    const filteredLocations = React.useMemo(() => {
        const needle = locationSearch.trim().toLowerCase();

        return locations.filter(location => {
            if (!needle) return true;
            return `${location.name} ${location.subtitle ?? ""}`.toLowerCase().includes(needle);
        });
    }, [locations, locationSearch]);

    async function executeSearch() {
        setError("");
        setResults([]);

        if (!query.trim()) {
            setError("Enter a message search first.");
            return;
        }

        if (scope !== "everywhere" && !selected) {
            setError("Choose a server, DM, or channel.");
            return;
        }

        setLoadingSearch(true);

        try {
            const targets =
                scope === "everywhere"
                    ? locations.filter(location => location.type === "guild" || location.type === "dm")
                    : [selected!];

            addHistory(query, scope, selected);

            const nextFilters = {
                ...filters,
                content: query,
            };

            const chunks = await runPool(
                targets,
                target => searchLocation(target, nextFilters, sort, order),
                getSetting("parallelism", 5),
            );

            const merged = chunks
                .flatMap(chunk => chunk ?? [])
                .sort((a, b) => {
                    const left = Date.parse(a.timestamp);
                    const right = Date.parse(b.timestamp);
                    return order === "desc" ? right - left : left - right;
                });

            const unique = new Map<string, SearchResult>();
            for (const result of merged) unique.set(result.id, result);

            setResults([...unique.values()]);
        } catch (searchError: any) {
            setError(String(searchError?.message ?? searchError));
        } finally {
            setLoadingSearch(false);
        }
    }

    return (
        <ScrollView style={{ flex: 1, backgroundColor: "#111214" }} contentContainerStyle={{ padding: 16 }}>
            <Text style={{ color: "#f2f3f5", fontSize: 25, fontWeight: "800", marginBottom: 4 }}>
                Search+
            </Text>

            <Text style={{ color: "#949ba4", marginBottom: 15 }}>
                Search messages across your Discord account.
            </Text>

            <Input
                value={query}
                onChangeText={setQuery}
                placeholder="Search messages..."
                returnKeyType="search"
                onSubmitEditing={executeSearch}
            />

            <Section title="Scope">
                <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                    {(["everywhere", "guild", "dm", "channel"] as Scope[]).map(value => (
                        <Pressable
                            key={value}
                            onPress={() => {
                                setScope(value);
                                setSelected(undefined);
                            }}
                            style={{
                                paddingHorizontal: 12,
                                paddingVertical: 9,
                                borderRadius: 9,
                                backgroundColor: scope === value ? "#5865f2" : "#1e1f22",
                                marginRight: 7,
                                marginBottom: 7,
                            }}
                        >
                            <Text style={{ color: "#fff", fontWeight: "700" }}>
                                {value === "guild" ? "Server" : value[0].toUpperCase() + value.slice(1)}
                            </Text>
                        </Pressable>
                    ))}
                </View>
            </Section>

            {scope !== "everywhere" && (
                <Section title="Location">
                    <Input
                        value={locationSearch}
                        onChangeText={setLocationSearch}
                        placeholder="Find servers, DMs, channels..."
                    />

                    {loadingLocations ? (
                        <ActivityIndicator />
                    ) : (
                        filteredLocations
                            .filter(location => {
                                if (scope === "guild") return location.type === "guild";
                                if (scope === "dm") return location.type === "dm";
                                return location.type === "channel";
                            })
                            .slice(0, 100)
                            .map(location => (
                                <LocationRow
                                    key={`${location.type}:${location.id}`}
                                    location={location}
                                    selected={selected?.id === location.id && selected.type === location.type}
                                    onPress={() => setSelected(location)}
                                />
                            ))
                    )}
                </Section>
            )}

            <Section title="Filters">
                <Label>Author ID</Label>
                <Input
                    value={filters.authorId}
                    onChangeText={(value: string) => setFilters({ ...filters, authorId: value })}
                    placeholder="Optional user ID"
                />

                <Label>Mentioned user ID</Label>
                <Input
                    value={filters.mentions}
                    onChangeText={(value: string) => setFilters({ ...filters, mentions: value })}
                    placeholder="Optional user ID"
                />

                <Label>Link hostname</Label>
                <Input
                    value={filters.linkHostname}
                    onChangeText={(value: string) => setFilters({ ...filters, linkHostname: value })}
                    placeholder="example.com"
                />

                <Label>Attachment extension</Label>
                <Input
                    value={filters.attachmentExtension}
                    onChangeText={(value: string) => setFilters({ ...filters, attachmentExtension: value })}
                    placeholder="png, mp4, pdf..."
                />

                <Label>Attachment filename</Label>
                <Input
                    value={filters.attachmentFilename}
                    onChangeText={(value: string) => setFilters({ ...filters, attachmentFilename: value })}
                    placeholder="report"
                />

                <Label>After</Label>
                <Input
                    value={filters.after}
                    onChangeText={(value: string) => setFilters({ ...filters, after: value })}
                    placeholder="ISO timestamp or message ID"
                />

                <Label>Before</Label>
                <Input
                    value={filters.before}
                    onChangeText={(value: string) => setFilters({ ...filters, before: value })}
                    placeholder="ISO timestamp or message ID"
                />

                <Label>Author type</Label>
                <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                    {["", "user", "bot", "webhook"].map(value => (
                        <Pressable
                            key={value || "all"}
                            onPress={() => setFilters({ ...filters, authorType: value as SearchFilters["authorType"] })}
                            style={{
                                backgroundColor: filters.authorType === value ? "#5865f2" : "#1e1f22",
                                paddingHorizontal: 11,
                                paddingVertical: 8,
                                borderRadius: 8,
                                marginRight: 6,
                                marginBottom: 6,
                            }}
                        >
                            <Text style={{ color: "#fff" }}>{value || "Everyone"}</Text>
                        </Pressable>
                    ))}
                </View>

                <Label>Contains</Label>
                <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                    {["link", "embed", "file", "image", "video", "poll"].map(value => {
                        const active = filters.has.includes(value);
                        return (
                            <Pressable
                                key={value}
                                onPress={() =>
                                    setFilters({
                                        ...filters,
                                        has: active
                                            ? filters.has.filter(item => item !== value)
                                            : [...filters.has, value],
                                    })
                                }
                                style={{
                                    backgroundColor: active ? "#5865f2" : "#1e1f22",
                                    paddingHorizontal: 11,
                                    paddingVertical: 8,
                                    borderRadius: 8,
                                    marginRight: 6,
                                    marginBottom: 6,
                                }}
                            >
                                <Text style={{ color: "#fff" }}>{value}</Text>
                            </Pressable>
                        );
                    })}
                </View>
            </Section>

            <Section title="Sort">
                <View style={{ flexDirection: "row" }}>
                    {(["timestamp", "relevance"] as Sort[]).map(value => (
                        <Pressable
                            key={value}
                            onPress={() => setSort(value)}
                            style={{
                                backgroundColor: sort === value ? "#5865f2" : "#1e1f22",
                                paddingHorizontal: 12,
                                paddingVertical: 9,
                                borderRadius: 8,
                                marginRight: 7,
                            }}
                        >
                            <Text style={{ color: "#fff" }}>
                                {value === "timestamp" ? "Time" : "Relevance"}
                            </Text>
                        </Pressable>
                    ))}
                </View>

                <View style={{ flexDirection: "row", marginTop: 8 }}>
                    {(["desc", "asc"] as Order[]).map(value => (
                        <Pressable
                            key={value}
                            onPress={() => setOrder(value)}
                            style={{
                                backgroundColor: order === value ? "#5865f2" : "#1e1f22",
                                paddingHorizontal: 12,
                                paddingVertical: 9,
                                borderRadius: 8,
                                marginRight: 7,
                            }}
                        >
                            <Text style={{ color: "#fff" }}>
                                {value === "desc" ? "Newest" : "Oldest"}
                            </Text>
                        </Pressable>
                    ))}
                </View>
            </Section>

            <Button
                title={loadingSearch ? "Searching..." : "Search Discord"}
                onPress={executeSearch}
                disabled={loadingSearch}
            />

            {!!error && (
                <View style={{ backgroundColor: "#4a2428", borderRadius: 10, padding: 12, marginBottom: 12 }}>
                    <Text style={{ color: "#ffb3b8" }}>{error}</Text>
                </View>
            )}

            {!!results.length && (
                <Section title={`${results.length} results`}>
                    {results.map(result => (
                        <Pressable
                            key={`${result.channelId}:${result.id}`}
                            onPress={() => jumpToResult(result)}
                            style={{
                                backgroundColor: "#1e1f22",
                                borderRadius: 10,
                                padding: 12,
                                marginBottom: 8,
                            }}
                        >
                            <Text style={{ color: "#f2f3f5", fontWeight: "700" }}>
                                {result.author?.global_name || result.author?.username || "Unknown user"}
                            </Text>
                            <Text style={{ color: "#949ba4", fontSize: 12, marginTop: 2 }}>
                                {new Date(result.timestamp).toLocaleString()}
                            </Text>
                            <Text style={{ color: "#dbdee1", marginTop: 7 }} numberOfLines={8}>
                                {result.content || "[No text content]"}
                            </Text>
                            {!!result.attachments?.length && (
                                <Text style={{ color: "#949ba4", fontSize: 12, marginTop: 7 }}>
                                    {result.attachments.length} attachment{result.attachments.length === 1 ? "" : "s"}
                                </Text>
                            )}
                        </Pressable>
                    ))}
                </Section>
            )}
        </ScrollView>
    );
}

let navigation: any = null;

function openSearchScreen() {
    const nav = findByProps("push", "pop", "replace");
    if (nav?.push) {
        nav.push("SearchPlus", { component: SearchScreen });
        return;
    }

    const stack = findByProps("open", "close");
    if (stack?.open) {
        stack.open({
            title: "Search+",
            render: () => <SearchScreen />,
        });
        return;
    }

    console.warn("[Search+] Could not locate a navigation/modal API.");
}

export default {
    onLoad() {
        initialize();
    },

    onUnload() {
        navigation = null;
    },

    settings: Settings,
};
