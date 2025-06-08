import { TestRunner } from "@rbxts/runit";

const testRunner = new TestRunner(game.GetService("ReplicatedStorage").WaitForChild("Tests"));
testRunner.run({ colors: true }).await();