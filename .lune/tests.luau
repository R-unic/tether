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

roblox.implementMethod("RunService", "IsServer", function()
	return false
end)

roblox.implementMethod("RunService", "IsClient", function()
	return false
end)

roblox.implementMethod("RunService", "IsRunning", function()
	return false
end)

roblox.implementMethod("DataModel", "IsLoaded", function()
	return true
end)

roblox.implementProperty("UnreliableRemoteEvent", "OnClientEvent", function()
	return signal.new()
end)

roblox.implementProperty("UnreliableRemoteEvent", "OnServerEvent", function()
	return signal.new()
end)

roblox.implementProperty("RemoteEvent", "OnClientEvent", function()
	return signal.new()
end)

roblox.implementProperty("RemoteEvent", "OnServerEvent", function()
	return signal.new()
end)

roblox.implementMethod("RemoteEvent", "FireServer", function(self, ...)
  return self.OnServerEvent:Fire(game.Players.LocalPlayer, ...)
end)

roblox.implementMethod("RemoteEvent", "FireClient", function(self, player, ...)
  return self.OnClientEvent:Fire(...)
end)

roblox.implementMethod("RemoteEvent", "FireAllClients", function(self, ...)
  for _ in game.Players:GetPlayers() do
    self.OnClientEvent:Fire(...)
  end
end)

roblox.implementProperty("Players", "LocalPlayer", function()
	return roblox.Instance.new("Player")
end)

roblox.implementMethod("HttpService", "JSONEncode", function()
	return nil
end)

local robloxRequire
local TS
local function runRobloxScript(script: Script | LocalScript | ModuleScript)
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
      TS = TS
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

local runTests = game.ReplicatedStorage.Tests["run-tests"]
runRobloxScript(runTests)
for _, thread in threads do
	task.cancel(thread)
end