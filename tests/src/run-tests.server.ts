import { TestRunner } from "@rbxts/runit";
import { RunService } from "@rbxts/services";

const testsRoot = game.GetService("ReplicatedStorage").WaitForChild("Tests");
const root = testsRoot.WaitForChild(RunService.IsClient() ? "client" : "server");
const testRunner = new TestRunner(root);
testRunner.run({ colors: true }).await();