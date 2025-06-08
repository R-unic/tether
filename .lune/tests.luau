local roblox = require("@lune/roblox")
local fs = require("@lune/fs")
local luau = require("@lune/luau")
local process = require("@lune/process")
local task = require("@lune/task")

local signal = require("./mock-signal")

local testPlacePath = process.args[1]
local game = roblox.deserializePlace(fs.readFile(testPlacePath))
local threads: { thread } = {}

-- rUnit uses lemon signal
roblox.implementProperty("BindableEvent", "Event", function(get)
  return signal.new()
end)

local function tableJoin(...)
	local result = {}
	for i = 1, select("#", ...) do
		for k, v in select(i, ...) do
			result[k] = v
		end
	end
	return result
end

-- RuntimeLib uses :WaitForChild(), but tests don't need networking so :FindFirstChild() should be fine
roblox.implementMethod("Instance", "WaitForChild", function(self, ...)
	return self:FindFirstChild(...)
end)

local function memoize<T>(cache: { [string]: T }, key: string, getValue: () -> T): T
  local cached = cache[key]
  if cached then
    return cached
  end

  local value = getValue()
  cache[key] = value
  return value
end

-- Promise.lua indexes RunService.Heartbeat, but only uses it in Promise.defer and Promise.delay
local heartbeat = signal.new()
roblox.implementProperty("RunService", "Heartbeat", function()
	return heartbeat
end, function() end)

table.insert(threads, task.spawn(function()
	local lastFrame = os.clock();
	while true do
		task.wait();
		local dt = os.clock() - lastFrame
		heartbeat:Fire(dt)
	end
end))

roblox.implementMethod("RunService", "IsStudio", function()
	return true
end)

type LuneContext = "server" | "client" | "both"
local luneContext = "server"
roblox.implementMethod("RunService", "IsServer", function()
	return luneContext ~= "client"
end)

roblox.implementMethod("RunService", "IsClient", function()
	return luneContext ~= "server"
end)

roblox.implementMethod("RunService", "IsRunning", function()
	return false
end)

roblox.implementMethod("DataModel", "IsLoaded", function()
	return true
end)

local onClientEvents = {}
roblox.implementProperty("RemoteEvent", "OnClientEvent", function(self)
  -- terrible but is fine for our purposes
	return memoize(onClientEvents, self:GetFullName(), function()
    return signal.new()
  end)
end)

local onServerEvents = {}
roblox.implementProperty("RemoteEvent", "OnServerEvent", function(self)
  return memoize(onServerEvents, self:GetFullName(), function()
    return signal.new()
  end)
end)

roblox.implementMethod("RemoteEvent", "FireServer", function(self, ...)
  self.OnServerEvent:Fire(roblox.Instance.new("Player"), ...)
end)

roblox.implementMethod("RemoteEvent", "FireClient", function(self, player, ...)
  self.OnClientEvent:Fire(...)
end)

roblox.implementMethod("RemoteEvent", "FireAllClients", function(self, ...)
  for _ in game.Players:GetPlayers() do
    self.OnClientEvent:Fire(...)
  end
end)

local unreliableOnClientEvents = {}
roblox.implementProperty("UnreliableRemoteEvent", "OnClientEvent", function(self)
	return memoize(unreliableOnClientEvents, self:GetFullName(), function()
    return signal.new()
  end)
end)

local unreliableOnServerEvents = {}
roblox.implementProperty("UnreliableRemoteEvent", "OnServerEvent", function(self)
	return memoize(unreliableOnServerEvents, self:GetFullName(), function()
    return signal.new()
  end)
end)

roblox.implementMethod("UnreliableRemoteEvent", "FireServer", function(self, ...)
  self.OnServerEvent:Fire(roblox.Instance.new("Player"), ...)
end)

roblox.implementMethod("UnreliableRemoteEvent", "FireClient", function(self, player, ...)
  self.OnClientEvent:Fire(...)
end)

roblox.implementMethod("UnreliableRemoteEvent", "FireAllClients", function(self, ...)
  for _ in roblox.game.Players:GetPlayers() do
    self.OnClientEvent:Fire(...)
  end
end)

roblox.implementMethod("HttpService", "JSONEncode", function()
	return nil
end)

local robloxRequire
local TS
local function setLuneContext(ctx: LuneContext): ()
  luneContext = ctx
end

local function runRobloxScript(script: Script | LocalScript | ModuleScript): any
	local callableFn = luau.load(luau.compile(script.Source), {
		debugName = script:GetFullName(),
		environment = tableJoin(roblox, {
			Instance = roblox.Instance,
			game = game,
			script = script,
			require = robloxRequire,
			tick = tick,
			task = task,
			debug = debug,
      TS = TS,
      setLuneContext = setLuneContext
		})
	})

	return callableFn()
end

local requireCache = {}

function robloxRequire(moduleScript: ModuleScript)
	-- the same script instance sometimes gives a different ref
	-- unsure why, but using :GetFullName() fixes this for now
	local scriptPath = moduleScript:GetFullName()
	local cached = requireCache[scriptPath]
	if cached then
		return table.unpack(cached)
	end

	local result = table.pack(runRobloxScript(moduleScript))
	requireCache[scriptPath] = result
	return table.unpack(result)
end

TS = robloxRequire(game:GetService("ReplicatedStorage"):WaitForChild("rbxts_include"):WaitForChild("RuntimeLib"))

runRobloxScript(game.ReplicatedStorage.Tests["run-tests"])
for _, thread in threads do
	task.cancel(thread)
end