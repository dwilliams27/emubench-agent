import { EmuCondition } from "@/shared/conditions/types";

export interface EmuTestResult {
  emuCondition: EmuCondition;
  conditionResult: 'passed' | 'failed' | 'error';
  conditionNumericalResult?: number;
}
